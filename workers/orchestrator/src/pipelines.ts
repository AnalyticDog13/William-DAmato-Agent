import {
  companyIdentityKey,
  identityKeys,
  newId,
  newTraceId,
  normalizeDomain,
  normalizeEmail,
  nowIso,
  scoreLead,
  type Company,
  type Contact,
  type Job,
  type DeploymentRecord,
  type Lead,
  type Niche,
  type Opportunity,
  type SiteProject,
  type SourceProvenance,
} from "@william/core";
import type { ExecutionResult } from "@william/integrations";
import { dirname, join } from "node:path";
import { auditWebsite, qualityCheckPreview } from "@william/worker-site-auditor";
import {
  OPT_OUT_LINE,
  classifyReply,
  createFirstTouchDraft,
  recommendedNextStep,
  screenForContactability,
  validateDraft,
} from "@william/worker-outreach";
import { applyRevisionOverrides, buildPreviewSite } from "@william/worker-site-builder";
import { createInvoiceDraft, executeInvoiceDraft } from "@william/worker-billing";
import { suggestCall } from "@william/worker-scheduling";
import { requestApproval } from "./approvals";
import { evaluateGate, operationalTicket, type AppContext } from "./context";

// ─── Lead intake (synchronous entry point used by API, CSV import, seeds) ───

export interface LeadInput {
  companyName: string;
  websiteUrl?: string | null;
  niche: Niche;
  city?: string | null;
  region?: string | null;
  phone?: string | null;
  address?: string | null;
  email?: string | null;
  description?: string;
  source: SourceProvenance;
}

export type IntakeResult =
  | { outcome: "created"; lead: Lead }
  | { outcome: "duplicate"; existingLeadId: string }
  | { outcome: "blocked"; reasons: string[] };

export function ingestLead(ctx: AppContext, input: LeadInput): IntakeResult {
  const traceId = newTraceId();
  const domain = input.websiteUrl ? normalizeDomain(input.websiteUrl) : null;
  const email = input.email ? normalizeEmail(input.email) : null;
  const companyKey = companyIdentityKey(input.companyName, input.city);
  const keys = identityKeys({ domain, email, companyKey });

  // Dedupe: any matching identity key means duplicate.
  for (const key of keys) {
    const existing = ctx.store.leads.findByKey(key)[0];
    if (existing) return { outcome: "duplicate", existingLeadId: existing.id };
  }

  // DNC/unsubscribe screen at the door.
  const screen = screenForContactability(ctx.store, keys, email);
  if (screen.blocked) {
    ctx.store.writeCompliance("dnc_blocked", `Intake refused for ${input.companyName}: ${screen.reasons.join("; ")}`, {
      traceId,
    });
    return { outcome: "blocked", reasons: screen.reasons };
  }

  const now = nowIso();
  const company: Company = {
    id: newId("com"),
    createdAt: now,
    updatedAt: now,
    name: input.companyName,
    identityKey: companyKey,
    niche: input.niche,
    city: input.city ?? null,
    region: input.region ?? null,
    country: "US",
    phone: input.phone ?? null,
    address: input.address ?? null,
    socialLinks: {},
    description: input.description ?? "",
  };
  ctx.store.companies.insert(company);

  const lead: Lead = {
    id: newId("lead"),
    createdAt: now,
    updatedAt: now,
    companyId: company.id,
    domain,
    websiteUrl: domain ? (input.websiteUrl!.startsWith("http") ? input.websiteUrl! : `https://${domain}`) : null,
    niche: input.niche,
    status: "new",
    source: input.source,
    identityKeys: keys,
    notes: "",
    disqualifiedReason: null,
  };
  ctx.store.leads.insert(lead);
  ctx.store.writeActivity(lead.id, "lead_created", `Lead ingested from ${input.source.kind} (${input.source.detail})`, { traceId });

  if (email) {
    ctx.store.contacts.insert({
      id: newId("con"),
      createdAt: now,
      updatedAt: now,
      leadId: lead.id,
      companyId: company.id,
      name: null,
      role: null,
      email,
      emailSource: "owner_provided",
      emailProvider: null,
      verification: "unverified",
      confidence: 0.8,
      phone: input.phone ?? null,
    });
  }

  ctx.store.queue.enqueue({ type: "lead.audit", payload: { leadId: lead.id }, traceId, leadId: lead.id });
  return { outcome: "created", lead };
}

// ─── Job handlers ────────────────────────────────────────────────────────────

export type JobHandler = (ctx: AppContext, job: Job) => Promise<void>;

function getLead(ctx: AppContext, job: Job): Lead {
  const leadId = job.payload.leadId as string;
  const lead = ctx.store.leads.get(leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  return lead;
}

function setLeadStatus(ctx: AppContext, lead: Lead, status: Lead["status"], note?: string): Lead {
  const updated = { ...lead, status, ...(note ? { disqualifiedReason: note } : {}) };
  ctx.store.leads.save(updated);
  return updated;
}

const handleAudit: JobHandler = async (ctx, job) => {
  let lead = getLead(ctx, job);
  lead = setLeadStatus(ctx, lead, "auditing");
  const ticket = operationalTicket(ctx, "site_audit.crawl", { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId);
  const audit = await auditWebsite(lead, {
    mode: ctx.config.auditorMode,
    log: ctx.log,
    ticket,
    dataDir: ctx.config.dataDir,
    launchBrowser: ctx.browserLauncher,
  });
  ctx.store.audits.insert(audit);
  if (audit.robotsAllowed === false) {
    ctx.store.writeCompliance("robots_respected", `Crawl skipped for ${lead.domain} per robots.txt`, {
      leadId: lead.id,
      traceId: job.traceId,
    });
  }
  setLeadStatus(ctx, lead, "audited");
  ctx.store.writeActivity(lead.id, "audit_completed", audit.summary, { traceId: job.traceId, data: { auditId: audit.id, auditScore: audit.auditScore } });
  ctx.store.queue.enqueue({ type: "lead.score", payload: { leadId: lead.id, auditId: audit.id }, traceId: job.traceId, leadId: lead.id });
};

const handleScore: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  const audit = ctx.store.audits.get(job.payload.auditId as string);
  if (!audit) throw new Error(`Audit ${job.payload.auditId} not found`);
  const result = scoreLead(audit);
  const now = nowIso();
  ctx.store.leadScores.insert({
    id: newId("scr"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    auditId: audit.id,
    score: result.score,
    tier: result.tier,
    reasons: result.reasons,
    scoredAt: now,
  });
  ctx.store.writeActivity(lead.id, "lead_scored", `Scored ${result.score}/100 (${result.tier})`, {
    traceId: job.traceId,
    data: { reasons: result.reasons },
  });
  if (result.tier === "skip") {
    setLeadStatus(ctx, { ...lead, status: "disqualified" }, "disqualified", `Score ${result.score} below contact threshold`);
    return;
  }
  setLeadStatus(ctx, lead, "scored");
  ctx.store.queue.enqueue({ type: "lead.contact", payload: { leadId: lead.id, auditId: audit.id }, traceId: job.traceId, leadId: lead.id });
};

const handleContact: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  const audit = ctx.store.audits.get(job.payload.auditId as string);
  const existing = ctx.store.contacts.list({ leadId: lead.id })[0];
  let contact: Contact | undefined = existing;

  if (!contact) {
    // 1) Business-published contact data first (preferred source).
    const published = audit?.extracted.contactEmails[0];
    if (published) {
      const now = nowIso();
      contact = ctx.store.contacts.insert({
        id: newId("con"),
        createdAt: now,
        updatedAt: now,
        leadId: lead.id,
        companyId: lead.companyId,
        name: null,
        role: null,
        email: published,
        emailSource: "website_published",
        emailProvider: null,
        verification: "unverified",
        confidence: 0.7,
        phone: audit?.extracted.phones[0] ?? null,
      });
    } else {
      // 2) Enrichment provider (mock until ENRICHMENT_API_KEY exists).
      const ticket = operationalTicket(ctx, "enrichment.findContacts", { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId);
      const candidates = lead.domain ? await ctx.integrations.enrichment.findContacts(ticket, lead.domain) : [];
      const best = candidates[0];
      if (best) {
        const now = nowIso();
        contact = ctx.store.contacts.insert({
          id: newId("con"),
          createdAt: now,
          updatedAt: now,
          leadId: lead.id,
          companyId: lead.companyId,
          name: best.name,
          role: best.role,
          email: best.email,
          emailSource: "enrichment",
          emailProvider: best.provider,
          verification: "unverified",
          confidence: best.confidence,
          phone: null,
        });
      }
    }
  }

  if (!contact?.email) {
    setLeadStatus(ctx, lead, "disqualified", "No contactable email found (published or enriched)");
    ctx.memory.requestFromOwner({
      title: "Choose and configure a contact-enrichment + email-verification provider",
      whyItMatters:
        "Leads without website-published emails are currently dead ends. An enrichment provider (e.g. Hunter, Apollo) plus a verifier (e.g. NeverBounce, ZeroBounce) unblocks them.",
      neededFields: ["ENRICHMENT_API_KEY", "EMAIL_VERIFY_API_KEY", "provider choice + plan"],
      credentialKind: "either",
      unblocks: ["contact discovery for leads without published emails", "bounce-rate protection via pre-send verification"],
      category: "credentials",
    });
    return;
  }

  // 3) Verify before outreach.
  const ticket = operationalTicket(ctx, "enrichment.verifyEmail", { type: "Contact", id: contact.id, leadId: lead.id }, job.traceId);
  const verdict = await ctx.integrations.enrichment.verifyEmail(ticket, contact.email);
  contact = ctx.store.contacts.save({
    ...contact,
    verification: verdict.status === "valid" ? "valid" : verdict.status === "risky" ? "risky" : "invalid",
  });
  if (contact.verification === "invalid") {
    setLeadStatus(ctx, lead, "disqualified", `Email ${contact.email} failed verification`);
    return;
  }
  setLeadStatus(ctx, lead, "contact_ready");
  ctx.store.writeActivity(lead.id, "contact_found", `Contact ${contact.email} (${contact.emailSource}, ${contact.verification})`, { traceId: job.traceId });
  ctx.store.queue.enqueue({ type: "outreach.draft", payload: { leadId: lead.id, contactId: contact.id, auditId: job.payload.auditId }, traceId: job.traceId, leadId: lead.id });
};

const handleDraft: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  const contact = ctx.store.contacts.get(job.payload.contactId as string);
  const audit = ctx.store.audits.get(job.payload.auditId as string);
  const company = ctx.store.companies.get(lead.companyId);
  if (!contact || !audit || !company) throw new Error("Draft inputs missing (contact/audit/company)");

  // Re-screen immediately before drafting — DNC may have changed since intake.
  const screen = screenForContactability(ctx.store, lead.identityKeys, contact.email);
  if (screen.blocked) {
    ctx.store.writeCompliance("dnc_blocked", `Draft refused: ${screen.reasons.join("; ")}`, { leadId: lead.id, traceId: job.traceId });
    setLeadStatus(ctx, lead, "do_not_contact", screen.reasons.join("; "));
    return;
  }

  const draft = createFirstTouchDraft({ lead, company, contact, audit, traceId: job.traceId });
  const problems = validateDraft(draft);
  if (problems.length > 0) throw new Error(`Draft failed content rules: ${problems.join(", ")}`);

  const approval = requestApproval(ctx, {
    gate: "SEND_FIRST_TOUCH",
    subjectType: "OutreachDraft",
    subjectId: draft.id,
    leadId: lead.id,
    title: `First-touch email to ${contact.email} (${company.name})`,
    detail: `Subject: ${draft.subject}\n\n${draft.body}`,
    traceId: job.traceId,
  });
  ctx.store.outreachDrafts.insert({ ...draft, status: "pending_approval", approvalRequestId: approval.id });
  setLeadStatus(ctx, lead, "draft_ready");
  ctx.store.writeActivity(lead.id, "draft_created", `Outreach draft awaiting owner approval in Review Queue`, { traceId: job.traceId });
};

/** Enqueued by the API when the owner grants a SEND_FIRST_TOUCH approval. */
const handleSend: JobHandler = async (ctx, job) => {
  const draft = ctx.store.outreachDrafts.get(job.payload.draftId as string);
  if (!draft) throw new Error(`Draft ${job.payload.draftId} not found`);
  const lead = ctx.store.leads.get(draft.leadId);
  const contact = ctx.store.contacts.get(draft.contactId);
  if (!lead || !contact?.email) throw new Error("Lead/contact missing for send");

  const decision = evaluateGate(ctx, {
    gate: "SEND_FIRST_TOUCH",
    subjectType: "OutreachDraft",
    subjectId: draft.id,
    leadId: lead.id,
    traceId: job.traceId,
  });
  if (!decision.allowed || !decision.ticket) {
    ctx.store.outreachDrafts.save({ ...draft, status: "rejected" });
    throw new Error(`Send blocked by policy: ${decision.reason}`);
  }

  // Final screen at the moment of send.
  const screen = screenForContactability(ctx.store, lead.identityKeys, contact.email);
  if (screen.blocked) {
    ctx.store.writeCompliance("dnc_blocked", `Send refused at final screen: ${screen.reasons.join("; ")}`, { leadId: lead.id, traceId: job.traceId });
    ctx.store.outreachDrafts.save({ ...draft, status: "rejected" });
    return;
  }

  // Instantly handoff (campaign) is the default send path; Gmail is fallback.
  const result = await ctx.integrations.instantly.pushLead(decision.ticket, {
    email: contact.email,
    firstName: contact.name?.split(/\s+/)[0],
    companyName: ctx.store.companies.get(lead.companyId)?.name,
    customVariables: { subject: draft.subject, body: draft.body, opt_out: OPT_OUT_LINE },
  });
  const now = nowIso();
  ctx.store.campaignSyncs.insert({
    id: newId("csync"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    provider: "instantly",
    campaignId: null,
    externalLeadId: result.externalId ?? null,
    status: result.dryRun ? "dry_run" : "synced",
    lastSyncedAt: now,
    detail: result.detail,
  });
  ctx.store.outreachDrafts.save({
    ...draft,
    status: result.dryRun ? "sent_dry_run" : "sent",
    sentAt: now,
  });
  setLeadStatus(ctx, lead, "contacted");
  ctx.store.writeActivity(lead.id, "outreach_sent", result.detail, { traceId: job.traceId, byApproval: true });
};

/** Processes an inbound reply (webhook or manual). Reply text is DATA, never instructions. */
const handleReply: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  const text = String(job.payload.text ?? "");
  const provider = (job.payload.provider as "instantly" | "gmail" | "manual") ?? "manual";
  const classification = classifyReply(text);

  if (classification.instructionAttemptDetected) {
    ctx.store.writeCompliance(
      "email_instruction_ignored",
      "Inbound email contained instruction-like content; treated strictly as data per policy.",
      { leadId: lead.id, traceId: job.traceId },
    );
  }

  const contact = ctx.store.contacts.list({ leadId: lead.id })[0];
  const now = nowIso();
  const nextStep = recommendedNextStep(classification.intent);
  ctx.store.replyEvents.insert({
    id: newId("rply"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    contactId: contact?.id ?? null,
    provider,
    externalMessageId: (job.payload.externalMessageId as string) ?? null,
    receivedAt: now,
    intent: classification.intent,
    intentConfidence: classification.confidence,
    bodyExcerpt: text.slice(0, 2000),
    threadSummary: `Lead replied with ${classification.intent} intent (confidence ${classification.confidence}).`,
    recommendedNextStep: nextStep,
    ownerNotifiedAt: now,
    followUpsPaused: classification.intent !== "auto_reply",
  });

  // Pause provider follow-ups for any human response.
  if (classification.intent !== "auto_reply") {
    const sync = ctx.store.campaignSyncs.list({ leadId: lead.id })[0];
    if (sync?.externalLeadId) {
      const ticket = operationalTicket(ctx, "instantly.pauseLead", { type: "CampaignSync", id: sync.id, leadId: lead.id }, job.traceId);
      await ctx.integrations.instantly.pauseLead(ticket, sync.externalLeadId);
      ctx.store.campaignSyncs.save({ ...sync, status: "paused" });
    }
  }

  switch (classification.intent) {
    case "unsubscribe": {
      ctx.store.unsubscribes.insert({
        id: newId("unsub"),
        createdAt: now,
        updatedAt: now,
        email: contact?.email ?? "unknown",
        leadId: lead.id,
        source: "reply",
        reason: "Replied with opt-out request",
      });
      for (const key of lead.identityKeys) {
        ctx.store.doNotContact.insert({
          id: newId("dnc"),
          createdAt: now,
          updatedAt: now,
          identityKey: key,
          reason: "Lead opted out by reply",
          addedBy: "system",
        });
      }
      ctx.store.writeCompliance("unsubscribe_honored", `Opt-out honored for lead ${lead.id}`, { leadId: lead.id, traceId: job.traceId });
      setLeadStatus(ctx, lead, "do_not_contact", "Opted out by reply");
      break;
    }
    case "positive": {
      const opportunity: Opportunity = {
        id: newId("opp"),
        createdAt: now,
        updatedAt: now,
        leadId: lead.id,
        stage: "new_interest",
        valueUsd: null,
        threadSummary: `Positive reply received via ${provider}.`,
        recommendedNextStep: nextStep,
        lostReason: null,
        history: [{ at: now, stage: "new_interest", note: "Positive reply classified" }],
      };
      ctx.store.opportunities.insert(opportunity);
      setLeadStatus(ctx, lead, "opportunity");
      // Owner is notified IMMEDIATELY; William never schedules anything itself.
      ctx.store.writeActivity(lead.id, "owner_notification", `🔥 POSITIVE REPLY — review thread and next steps. ${nextStep}`, { traceId: job.traceId });
      const ticket = operationalTicket(ctx, "calendar.freeBusy", { type: "Opportunity", id: opportunity.id, leadId: lead.id }, job.traceId);
      const suggestion = await suggestCall(lead, "Positive reply — discovery call recommended", ctx.integrations.calendar, ticket, opportunity.id);
      ctx.store.callSuggestions.insert(suggestion);
      ctx.store.queue.enqueue({ type: "preview.build", payload: { leadId: lead.id, opportunityId: opportunity.id }, traceId: job.traceId, leadId: lead.id });
      break;
    }
    case "negative": {
      setLeadStatus(ctx, lead, "replied");
      break;
    }
    case "bounce": {
      const draft = ctx.store.outreachDrafts.list({ leadId: lead.id })[0];
      if (draft) ctx.store.outreachDrafts.save({ ...draft, status: "bounced" });
      if (contact) ctx.store.contacts.save({ ...contact, verification: "invalid" });
      setLeadStatus(ctx, lead, "replied");
      break;
    }
    default:
      setLeadStatus(ctx, lead, "replied");
  }
  ctx.store.writeActivity(lead.id, "reply_processed", `Intent: ${classification.intent} → ${nextStep}`, { traceId: job.traceId });
};

// Browser-grade quality gate before owner review — only in playwright mode
// so demo/CI (mock) never needs browser binaries.
async function attachQualityCheck(
  ctx: AppContext,
  project: SiteProject,
  leadId: string,
): Promise<{ project: SiteProject; note: string }> {
  if (ctx.config.auditorMode !== "playwright" || !project.previewPath) return { project, note: "" };
  const qc = await qualityCheckPreview({
    previewPath: project.previewPath,
    outDir: join(ctx.config.dataDir, "screenshots", leadId),
    log: ctx.log,
    launchBrowser: ctx.browserLauncher,
    thresholds: ctx.config.previewQuality,
  });
  if (!qc) return { project, note: " Quality check skipped (browser unavailable)." };
  const fmt = (v: boolean | null) => (v === null ? "n/a" : v ? "passed" : "FAILED");
  return {
    project: {
      ...project,
      screenshotPaths: qc.screenshotPaths,
      qualityCheck: { lighthousePassed: qc.lighthousePassed, a11yPassed: qc.a11yPassed, notes: qc.notes },
    },
    note: ` Quality check: lighthouse ${fmt(qc.lighthousePassed)}, a11y ${fmt(qc.a11yPassed)}.`,
  };
}

/** Vercel project names: lowercase slug, stable per company. */
function deployProjectName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `wd-${slug || "site"}`;
}

function recordDeployment(
  ctx: AppContext,
  project: SiteProject,
  target: "preview" | "production",
  result: ExecutionResult,
  approvalRequestId: string | null,
): DeploymentRecord {
  const now = nowIso();
  const record: DeploymentRecord = {
    id: newId("dpl"),
    createdAt: now,
    updatedAt: now,
    siteProjectId: project.id,
    target,
    provider: "vercel",
    status: result.dryRun ? "dry_run" : result.ok ? "deployed" : "failed",
    url: result.url ?? null,
    branch: null,
    approvalRequestId,
    qualityChecks: project.qualityCheck,
    rollbackOf: null,
    errorLog: result.ok ? null : (result.detail ?? "unknown error"),
    deployedAt: result.ok && !result.dryRun ? now : null,
  };
  ctx.store.deployments.insert(record);
  return record;
}

const handlePreviewBuild: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  const company = ctx.store.companies.get(lead.companyId);
  if (!company) throw new Error("Company missing");
  const audit = ctx.store.audits.list({ leadId: lead.id })[0] ?? null;
  const built = buildPreviewSite({
    lead,
    company,
    audit,
    dataDir: ctx.config.dataDir,
    opportunityId: (job.payload.opportunityId as string) ?? null,
    stackMode: ctx.config.stackMode,
  });

  const { project: checked, note: qualityNote } = await attachQualityCheck(ctx, built, lead.id);
  let project = checked;

  // Preview deploys are operational (audited, ungated); production stays
  // behind DEPLOY_PRODUCTION. NOTE: operational tickets carry no credential,
  // so they are dry-run in EVERY env today — this records the intent without
  // uploading. TODO(phase-e): before plumbing credentials into operational
  // tickets, make preview deploys owner-triggered — this job is reachable
  // from webhook-originated positive replies (compliance advisory D4).
  const vercelCred = ctx.store.credentialStatuses.findByKey("integration:vercel")[0];
  if (vercelCred && vercelCred.mode !== "missing" && project.previewPath) {
    const ticket = operationalTicket(ctx, "vercel.deployPreview", { type: "SiteProject", id: project.id, leadId: lead.id }, job.traceId);
    const result = await ctx.integrations.vercel.deploy(ticket, {
      target: "preview",
      projectName: deployProjectName(company.name),
      sourcePath: project.buildPath ?? dirname(project.previewPath),
    });
    recordDeployment(ctx, project, "preview", result, null);
    if (result.ok && result.url) project = { ...project, previewUrl: result.url };
  }

  ctx.store.siteProjects.insert(project);
  ctx.store.writeActivity(
    lead.id,
    "preview_built",
    `Preview generated (template ${project.templateId}, ${project.stack} stack) — awaiting owner review.${qualityNote} ${project.missingInputs.length ? `Missing inputs: ${project.missingInputs.join(", ")}` : ""}`,
    { traceId: job.traceId, data: { previewPath: project.previewPath } },
  );
};

/** Enqueued by the API when the owner submits a revision request. */
const handleSiteRevise: JobHandler = async (ctx, job) => {
  const revision = ctx.store.siteRevisions.get(job.payload.revisionId as string);
  if (!revision) throw new Error(`SiteRevision ${job.payload.revisionId} not found`);
  const project = ctx.store.siteProjects.get(revision.siteProjectId);
  if (!project) throw new Error(`SiteProject ${revision.siteProjectId} not found`);

  const { project: revised, applied } = applyRevisionOverrides(
    project,
    revision.overrides as Record<string, unknown>,
    ctx.config.dataDir,
  );
  if (applied.length === 0) {
    // Blocked ≠ stuck: tell the owner exactly what to send instead.
    ctx.store.siteRevisions.save({
      ...revision,
      status: "rejected",
      resultNote:
        "No recognizable field overrides — free-text interpretation arrives with LLM-assisted builds (phase-e). Send structured fields: tagline, description, phone, email, address, city, hours, services, trustSignals.",
    });
    ctx.store.siteProjects.save({ ...project, status: "preview_ready", updatedAt: nowIso() });
    ctx.store.writeActivity(project.leadId, "revision_rejected", `Revision not auto-applicable: "${revision.request.slice(0, 120)}" — structured fields required.`, { traceId: job.traceId });
    return;
  }

  const { project: checked, note } = await attachQualityCheck(ctx, revised, project.leadId);
  ctx.store.siteProjects.save(checked);
  ctx.store.siteRevisions.save({ ...revision, status: "applied", resultNote: `Applied: ${applied.join(", ")}.${note}` });
  // The artifact changed: any DEPLOY_PRODUCTION approval was for content the
  // owner is no longer looking at — expire it so deploys must be re-requested.
  const staleApprovals = ctx.store.approvals
    .findByKey(`subject:DEPLOY_PRODUCTION:${project.id}`)
    .filter((a) => a.status === "pending" || a.status === "granted");
  for (const a of staleApprovals) {
    ctx.store.approvals.save({
      ...a,
      status: "expired",
      decisionNote: `${a.decisionNote} [auto-expired: revision ${revision.id} changed the artifact]`.trim(),
      updatedAt: nowIso(),
    });
  }
  ctx.store.writeActivity(project.leadId, "revision_applied", `Revision applied (${applied.join(", ")}) — preview re-rendered.${note}${staleApprovals.length ? " Existing deploy approval expired — re-request after review." : ""}`, { traceId: job.traceId });
};

/** Enqueued by the API ONLY when the owner grants DEPLOY_PRODUCTION. */
const handleDeployProduction: JobHandler = async (ctx, job) => {
  const project = ctx.store.siteProjects.get(job.payload.siteProjectId as string);
  if (!project) throw new Error(`SiteProject ${job.payload.siteProjectId} not found`);
  const lead = ctx.store.leads.get(project.leadId);
  const company = lead ? ctx.store.companies.get(lead.companyId) : null;
  const sourcePath = project.buildPath ?? (project.previewPath ? dirname(project.previewPath) : null);
  if (!sourcePath) throw new Error("Production deploy blocked: project has no build or preview artifact");
  // Quality gate re-check (checks → approval → deploy, never reordered): a
  // revision after approval could have changed the artifact.
  if (project.qualityCheck && (project.qualityCheck.lighthousePassed === false || project.qualityCheck.a11yPassed === false)) {
    throw new Error("Production deploy blocked: preview quality check failed — revise and re-request");
  }
  const decision = evaluateGate(ctx, {
    gate: "DEPLOY_PRODUCTION",
    subjectType: "SiteProject",
    subjectId: project.id,
    leadId: project.leadId,
    traceId: job.traceId,
  });
  if (!decision.allowed || !decision.ticket) throw new Error(`Production deploy blocked: ${decision.reason}`);

  ctx.store.siteProjects.save({ ...project, status: "deploying", updatedAt: nowIso() });
  const result = await ctx.integrations.vercel.deploy(decision.ticket, {
    target: "production",
    projectName: deployProjectName(company?.name ?? project.leadId),
    sourcePath,
  });
  recordDeployment(ctx, project, "production", result, (job.payload.approvalRequestId as string) ?? null);

  if (!result.ok) {
    ctx.store.siteProjects.save({ ...project, status: "approved_for_customer", updatedAt: nowIso() });
    ctx.memory.recordFailure({
      traceId: job.traceId,
      leadId: project.leadId,
      jobId: job.id,
      category: "integration_error",
      message: `Production deploy failed: ${result.detail ?? "unknown"}`,
      stack: null,
      retryable: true,
    });
    ctx.store.writeActivity(project.leadId, "deploy_failed", `Production deploy FAILED: ${result.detail ?? "unknown"}`, { traceId: job.traceId, byApproval: true });
    return;
  }
  const status = result.dryRun ? "approved_for_customer" : "live";
  ctx.store.siteProjects.save({ ...project, status, updatedAt: nowIso() });
  ctx.store.writeActivity(
    project.leadId,
    "deployed_production",
    result.dryRun
      ? `Production deploy SIMULATED (dry-run): ${result.detail ?? ""}`
      : `Site LIVE at ${result.url ?? "(url pending)"}`,
    { traceId: job.traceId, byApproval: true },
  );
};

const handleBillingDraft: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  const draft = createInvoiceDraft({
    lead,
    opportunityId: (job.payload.opportunityId as string) ?? null,
    kind: (job.payload.kind as "payment_link" | "invoice") ?? "payment_link",
    description: (job.payload.description as string) ?? "Website design & build",
    amountUsd: Number(job.payload.amountUsd ?? 750),
  });
  const approval = requestApproval(ctx, {
    gate: "SEND_PAYMENT_REQUEST",
    subjectType: "InvoiceDraft",
    subjectId: draft.id,
    leadId: lead.id,
    title: `${draft.kind === "payment_link" ? "Payment link" : "Invoice"} $${draft.amountUsd} for ${lead.domain ?? lead.id}`,
    detail: draft.description,
    traceId: job.traceId,
  });
  ctx.store.invoiceDrafts.insert({ ...draft, status: "pending_approval", approvalRequestId: approval.id });
  ctx.store.writeActivity(lead.id, "billing_draft_created", `Invoice draft $${draft.amountUsd} awaiting approval`, { traceId: job.traceId });
};

/** Enqueued by the API when the owner grants SEND_PAYMENT_REQUEST. */
const handleBillingExecute: JobHandler = async (ctx, job) => {
  const draft = ctx.store.invoiceDrafts.get(job.payload.invoiceDraftId as string);
  if (!draft) throw new Error(`InvoiceDraft ${job.payload.invoiceDraftId} not found`);
  const contact = ctx.store.contacts.list({ leadId: draft.leadId })[0];
  const decision = evaluateGate(ctx, {
    gate: "SEND_PAYMENT_REQUEST",
    subjectType: "InvoiceDraft",
    subjectId: draft.id,
    leadId: draft.leadId,
    traceId: job.traceId,
  });
  if (!decision.allowed || !decision.ticket) throw new Error(`Payment request blocked: ${decision.reason}`);
  const executed = await executeInvoiceDraft(draft, contact?.email ?? "unknown@unknown.invalid", ctx.integrations.stripe, decision.ticket);
  ctx.store.invoiceDrafts.save(executed);
  ctx.store.writeActivity(draft.leadId, "billing_executed", `${executed.status}: ${executed.url ?? executed.stripeObjectId ?? ""}`, { traceId: job.traceId, byApproval: true });
};

export const JOB_HANDLERS: Record<string, JobHandler> = {
  "lead.audit": handleAudit,
  "lead.score": handleScore,
  "lead.contact": handleContact,
  "outreach.draft": handleDraft,
  "outreach.send": handleSend,
  "reply.process": handleReply,
  "preview.build": handlePreviewBuild,
  "site.revise": handleSiteRevise,
  "deploy.production": handleDeployProduction,
  "billing.draft": handleBillingDraft,
  "billing.execute": handleBillingExecute,
};
