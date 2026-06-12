import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  newId,
  nowIso,
  type Company,
  type Lead,
  type SiteProject,
  type WebsiteAudit,
} from "@william/core";
import {
  DESIGN_PRINCIPLES,
  getTemplateById,
  referencesFor,
  renderPreviewSite,
  renderReactProject,
  selectTemplate,
  type CompanyData,
  type TemplateDefinition,
} from "@william/templates";

export interface BuildInput {
  lead: Lead;
  company: Company;
  audit: WebsiteAudit | null;
  dataDir: string;
  opportunityId?: string | null;
  /** "react" additionally emits a Vite+React+Framer Motion project (deploy artifact). */
  stackMode?: "static" | "react";
}

/**
 * Generates a preview site from the best-matching starter kit and the
 * company's public data. Output is written locally; the owner reviews it in
 * the dashboard (side-by-side with the audit) BEFORE anything customer-facing.
 * The static single-file preview is ALWAYS written (review + quality check
 * need no toolchain); STACK_MODE=react additionally emits the Vite+React+
 * Framer Motion project that production deploys upload.
 */
export function buildPreviewSite(input: BuildInput): SiteProject {
  const { lead, company, audit } = input;
  const selection = selectTemplate(lead.niche, { services: audit?.extracted.services });

  const companyData: CompanyData = {
    name: company.name,
    niche: lead.niche,
    description: company.description || undefined,
    phone: company.phone ?? audit?.extracted.phones[0] ?? null,
    email: audit?.extracted.contactEmails[0] ?? null,
    address: company.address,
    city: company.city ?? undefined,
    services: audit?.extracted.services.length ? audit.extracted.services : defaultServices(lead.niche),
    socialLinks: { ...company.socialLinks, ...audit?.extracted.socialLinks },
    trustSignals: audit?.extracted.trustSignals.length
      ? audit.extracted.trustSignals
      : undefined,
  };

  const html = renderPreviewSite(selection.template, companyData);
  const dir = join(input.dataDir, "previews", lead.id);
  mkdirSync(dir, { recursive: true });
  const previewPath = join(dir, "index.html");
  writeFileSync(previewPath, html, "utf8");

  const stack = input.stackMode ?? "static";
  const buildPath = stack === "react" ? writeReactBuild(selection.template, companyData, input.dataDir, lead.id) : null;

  const designRefs = referencesFor(refQueryFor(lead.niche));
  const missingInputs = computeMissingInputs(companyData);
  const now = nowIso();
  return {
    id: newId("site"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    opportunityId: input.opportunityId ?? null,
    templateId: selection.template.id,
    niche: lead.niche,
    status: missingInputs.length > 2 ? "gathering_inputs" : "preview_ready",
    previewUrl: null, // set by deployment pipeline after Vercel preview deploy
    previewPath,
    stack,
    buildPath,
    screenshotPaths: [], // populated by the playwright quality check in the orchestrator
    qualityCheck: null,
    rationale: [
      selection.rationale,
      designRefs.length
        ? `Design references consulted: ${designRefs.map((r) => `${r.name} (${r.url})`).join(", ")}.`
        : "",
      `Principles applied: ${DESIGN_PRINCIPLES.slice(0, 3).join(" ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
    companyData: companyData as unknown as Record<string, unknown>,
    missingInputs,
  };
}

function writeReactBuild(template: TemplateDefinition, data: CompanyData, dataDir: string, leadId: string): string {
  const buildDir = join(dataDir, "builds", leadId);
  for (const f of renderReactProject(template, data)) {
    const path = join(buildDir, f.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.data, "utf8");
  }
  return buildDir;
}

/** Fields a revision may change. Free text alone can't be applied (no LLM yet — TODO(phase-e)). */
export const REVISABLE_FIELDS = [
  "tagline",
  "description",
  "phone",
  "email",
  "address",
  "city",
  "hours",
  "services",
  "trustSignals",
] as const;

export interface RevisionResult {
  project: SiteProject;
  /** Which override fields were recognized and applied. Empty = nothing applicable. */
  applied: string[];
}

/**
 * Applies structured overrides to an existing project and re-renders its
 * artifacts in place (preview always; react build when stack === "react").
 * Unknown or wrongly-typed fields are ignored, not guessed.
 */
export function applyRevisionOverrides(
  project: SiteProject,
  overrides: Record<string, unknown>,
  dataDir: string,
): RevisionResult {
  const applied: string[] = [];
  const companyData = { ...(project.companyData as unknown as CompanyData) };
  for (const field of REVISABLE_FIELDS) {
    const value = overrides[field];
    if (value === undefined) continue;
    if (field === "services" || field === "trustSignals") {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        companyData[field] = value as string[];
        applied.push(field);
      }
    } else if (typeof value === "string" && value.trim()) {
      companyData[field] = value.trim();
      applied.push(field);
    }
  }
  if (applied.length === 0) return { project, applied };

  const template = getTemplateById(project.templateId) ?? selectTemplate(project.niche).template;
  const previewPath = project.previewPath ?? join(dataDir, "previews", project.leadId, "index.html");
  mkdirSync(dirname(previewPath), { recursive: true });
  writeFileSync(previewPath, renderPreviewSite(template, companyData), "utf8");
  const buildPath =
    project.stack === "react" ? writeReactBuild(template, companyData, dataDir, project.leadId) : project.buildPath;

  return {
    project: {
      ...project,
      previewPath,
      buildPath,
      companyData: companyData as unknown as Record<string, unknown>,
      missingInputs: computeMissingInputs(companyData),
      status: "preview_ready",
      updatedAt: nowIso(),
    },
    applied,
  };
}

function refQueryFor(niche: string): string {
  return niche === "fashion" || niche === "photographer" ? "hero" : "landing";
}

function defaultServices(niche: string): string[] {
  switch (niche) {
    case "barbershop":
      return ["Haircuts", "Beard Trims", "Hot Towel Shaves"];
    case "coffee_shop":
      return ["Espresso Drinks", "Fresh Pastries", "Whole Beans"];
    case "restaurant":
      return ["Dinner Menu", "Catering", "Private Events"];
    case "photographer":
      return ["Weddings", "Portraits", "Events"];
    case "fashion":
      return ["New Arrivals", "Lookbook", "Custom Pieces"];
    default:
      return ["Our Services"];
  }
}

function computeMissingInputs(data: CompanyData): string[] {
  const missing: string[] = [];
  if (!data.phone) missing.push("business phone number");
  if (!data.email) missing.push("contact email for the site");
  if (!data.address) missing.push("street address");
  if (!data.hours) missing.push("business hours");
  if (!data.description) missing.push("short business description");
  return missing;
}
