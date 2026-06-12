import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  referencesFor,
  renderPreviewSite,
  selectTemplate,
  type CompanyData,
} from "@william/templates";

export interface BuildInput {
  lead: Lead;
  company: Company;
  audit: WebsiteAudit | null;
  dataDir: string;
  opportunityId?: string | null;
}

/**
 * Generates a preview site from the best-matching starter kit and the
 * company's public data. Output is written locally; the owner reviews it in
 * the dashboard (side-by-side with the audit) BEFORE anything customer-facing.
 * Phase D: React + Framer Motion full builds (STACK_MODE=react) + Vercel
 * preview deploys replace the static single-file artifact.
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
    screenshotPaths: [], // TODO(phase-b): Playwright screenshots of the preview
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
