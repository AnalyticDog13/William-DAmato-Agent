import {
  DurableLesson,
  companyIdentityKey,
  firstRealEmail,
  identityKeys,
  isPlaceholderEmail,
  newId,
  newTraceId,
  nicheSearchQuery,
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
  type OutreachDraft,
  type SiteProject,
  type SourceProvenance,
  type SourcingRunStatus,
  type VisualAssessment,
  type WebsiteAudit,
  type WebsiteBrief,
} from "@william/core";
import type { CompanyScrapeHints, ExecutionResult, OutreachCopyRequest } from "@william/integrations";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { auditWebsite, crawlForEmail, launchChromium, lighthouseSlowAngle, qualityCheckPreview, runDeferredLighthouse } from "@william/worker-site-auditor";
import {
  DELIVERY_VARIANT,
  MAX_TOUCHES,
  NO_RESPONSE_CLOSE_DAYS,
  OPT_OUT_LINE,
  classifyReplyAssisted,
  createDeliveryDraft,
  createFirstTouchDraft,
  createFollowUpDraft,
  evaluateFollowUp,
  nextFollowUp,
  recommendedNextStep,
  screenForContactability,
  validateDraft,
} from "@william/worker-outreach";
import { applyRevisionOverrides, buildPreviewSite } from "@william/worker-site-builder";
import { createInvoiceDraft, executeInvoiceDraft } from "@william/worker-billing";
import { suggestCall } from "@william/worker-scheduling";
import { requestApproval } from "./approvals";
import { credentialFor, evaluateGate, localReadCredential, operationalTicket, type AppContext } from "./context";
import { assignVariant, runningExperiment } from "./experiments";
import { IN_FLIGHT_STATUSES, countQualified, leadResolved } from "./sourcing";

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

/**
 * Off-switch note (WILLIAM_BUILDS_WEBSITES=false, the default). The four
 * builder handlers stay registered so stale queued jobs no-op safely instead of
 * crashing; they early-return here and NEVER call buildPreviewSite,
 * applyRevisionOverrides, or vercel.deploy. William is the business head — he
 * generates a WebsiteBrief for the owner to build, not his own artifact.
 */
const BUILDER_DISABLED_NOTE =
  "Website builder is off (WILLIAM_BUILDS_WEBSITES=false) — William generates a WebsiteBrief for the owner to build instead of building/deploying the site himself.";

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
    // Defer Lighthouse to the score step (after a contactable email is resolved)
    // so we never run it on a lead we can't email. Only affects playwright mode;
    // mock/http decide their lighthouse at audit time as before.
    skipLighthouse: true,
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
  ctx.store.queue.enqueue({ type: "lead.contact", payload: { leadId: lead.id, auditId: audit.id }, traceId: job.traceId, leadId: lead.id });
};

const handleScore: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  let audit = ctx.store.audits.get(job.payload.auditId as string);
  if (!audit) throw new Error(`Audit ${job.payload.auditId} not found`);

  // Deferred Lighthouse. The audit skips Lighthouse (the expensive part) and we
  // run it HERE — handleScore only runs for leads that resolved a contactable
  // email (handleContact disqualifies and returns early otherwise), so an
  // un-emailable lead never incurs a Lighthouse run. Playwright mode only:
  // mock synthesizes scores and http never had them, both decided at audit time.
  // Robots was already honored upstream (a playwright audit only exists when the
  // crawl was allowed). Failure/no-browser ⇒ null ⇒ deterministic scoring.
  if (audit.mode === "playwright" && audit.url) {
    const lighthouse = await runDeferredLighthouse(audit.url, {
      log: ctx.log,
      launchBrowser: ctx.browserLauncher ?? launchChromium,
    });
    if (lighthouse) {
      audit = { ...audit, lighthouse };
      // Only NOW — with a real, throttled-mobile performance score — may we add
      // the "slow site" outreach claim. lighthouseSlowAngle returns null unless
      // Lighthouse confirms it, so a fast-painting site is never called slow.
      const slowAngle = lighthouseSlowAngle(lighthouse);
      if (slowAngle && !audit.outreachAngles.includes(slowAngle)) {
        audit = { ...audit, outreachAngles: [...audit.outreachAngles, slowAngle] };
      }
      ctx.store.audits.save(audit);
      ctx.store.writeActivity(lead.id, "lighthouse_scored", `Lighthouse perf ${lighthouse.performance ?? "n/a"}, a11y ${lighthouse.accessibility ?? "n/a"}, seo ${lighthouse.seo ?? "n/a"}${slowAngle ? " — confirmed slow" : ""}`, { traceId: job.traceId });
    }
  }

  // Visual qualification — only when screenshots exist (playwright mode). Read the
  // PNGs, base64-encode, and ask the vision model. Null (mock/http/dry-run/failure)
  // ⇒ deterministic-only score (unchanged behavior).
  let visual: VisualAssessment | null = null;
  const shot = audit.pages[0];
  const paths = [shot?.screenshotPath, shot?.mobileScreenshotPath].filter((p): p is string => !!p);
  if (paths.length > 0) {
    try {
      const images = paths.map((p) => ({ mediaType: "image/png" as const, dataBase64: readFileSync(p).toString("base64") }));
      const ticket = operationalTicket(ctx, "llm.scoreVisualDesign", { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId, credentialFor(ctx, "anthropic"));
      visual = await ctx.integrations.llm.scoreVisualDesign(ticket, {
        companyName: ctx.store.companies.get(lead.companyId)?.name ?? lead.domain ?? "the business",
        niche: lead.niche,
        weaknesses: audit.weaknesses.map((w) => w.detail),
        images,
      });
      if (visual) {
        ctx.store.audits.save({ ...audit, visualAssessment: visual });
        ctx.store.writeActivity(lead.id, "visual_scored", `Visual verdict ${visual.verdict} (${visual.visualOpportunityScore}/100, conf ${visual.confidence.toFixed(2)})`, { traceId: job.traceId });
      }
    } catch (err) {
      ctx.log.warn("visual scoring failed; scoring deterministically", { leadId: lead.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Reachability reflects the RESOLVED contact (homepage pass + Playwright crawl
  // + any real enrichment), not just the audit's HTML emails — so a crawl-found
  // email isn't penalized. handleContact runs before handleScore and disqualifies
  // (returning early) when no email is found, so a scored lead normally has one.
  const scoredContact = ctx.store.contacts.list({ leadId: lead.id })[0];
  const result = scoreLead(audit, visual, ctx.config.visualScoring, { reachableEmail: !!scoredContact?.email });
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
  // Contact was created by handleContact (which now runs before handleScore).
  const contact = ctx.store.contacts.list({ leadId: lead.id })[0];
  if (!contact) {
    setLeadStatus(ctx, lead, "disqualified", "No contact at score time");
    return;
  }
  ctx.store.queue.enqueue({ type: "outreach.draft", payload: { leadId: lead.id, contactId: contact.id, auditId: audit.id }, traceId: job.traceId, leadId: lead.id });
};

const handleContact: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  const audit = ctx.store.audits.get(job.payload.auditId as string);
  const existing = ctx.store.contacts.list({ leadId: lead.id })[0];
  let contact: Contact | undefined = existing;

  if (!contact) {
    const auditEmails = audit?.extracted.contactEmails ?? [];
    let resolvedEmail = firstRealEmail(auditEmails);          // 1) cheap homepage pass
    let source: "website_published" | "website_crawled" | "enrichment" = "website_published";
    let foundOn: string | null = null;

    // 2) Playwright escalation — only on a miss. The operational ticket governs
    //    dry-run: in local it's a dry-run ticket, so crawlForEmail simulates and
    //    returns empty (no browser launch, zero network).
    // `localReadCredential` returns sandbox/live unconditionally; that is safe
    //    ONLY because computeDryRun forces dry-run when env === "local" BEFORE
    //    the credential is consulted (invariant 3), so local can never crawl live.
    if (!resolvedEmail && lead.websiteUrl) {
      const crawlTicket = operationalTicket(ctx, "site_audit.crawl", { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId, localReadCredential(ctx));
      const crawl = await crawlForEmail(lead, {
        log: ctx.log,
        ticket: crawlTicket,
        launchBrowser: ctx.browserLauncher ?? launchChromium,
        subpaths: ctx.config.emailDiscovery.subpaths,
        maxPages: ctx.config.emailDiscovery.maxPages,
        pageTimeoutMs: ctx.config.emailDiscovery.pageTimeoutMs,
        budgetMs: ctx.config.emailDiscovery.budgetMs,
      });
      if (crawl.email) { resolvedEmail = crawl.email; source = "website_crawled"; foundOn = crawl.foundOn ?? null; }
    }

    // 3) An email resolved from the website (homepage pass or crawl) becomes the
    //    contact. We never GUESS an address (no info@<domain> fabrication): a lead
    //    with no real email found on its site is simply not contactable.
    if (resolvedEmail) {
      const now = nowIso();
      contact = ctx.store.contacts.insert({
        id: newId("con"),
        createdAt: now,
        updatedAt: now,
        leadId: lead.id,
        companyId: lead.companyId,
        name: null,
        role: null,
        email: resolvedEmail,
        emailSource: source,
        emailProvider: null,
        verification: "unverified",
        confidence: source === "website_published" ? 0.7 : 0.6,
        phone: audit?.extracted.phones[0] ?? null,
      });
      if (foundOn) ctx.store.writeActivity(lead.id, "contact_found", `Email ${resolvedEmail} found by crawl on ${foundOn}`, { traceId: job.traceId });
    } else if (lead.domain && credentialFor(ctx, "enrichment")) {
      // 4) Enrichment provider — ONLY when a real provider is configured
      //    (ENRICHMENT_API_KEY). This is NOT a guess: a configured provider
      //    returns real, found contacts. Its result is still validated by
      //    `isPlaceholderEmail` (a template/placeholder domain is rejected) and
      //    by the verify step below. With no provider configured this rung is
      //    skipped entirely, so the lead falls through to disqualified.
      const enrichTicket = operationalTicket(ctx, "enrichment.findContacts", { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId, credentialFor(ctx, "enrichment"));
      const best = (await ctx.integrations.enrichment.findContacts(enrichTicket, lead.domain))[0];
      if (best && !isPlaceholderEmail(best.email)) {
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
    setLeadStatus(ctx, lead, "disqualified", "No contactable email found (published, crawled, or enriched)");
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

  // 4) Verify before outreach.
  const ticket = operationalTicket(ctx, "enrichment.verifyEmail", { type: "Contact", id: contact.id, leadId: lead.id }, job.traceId, credentialFor(ctx, "email_verify"));
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
  ctx.store.queue.enqueue({ type: "lead.score", payload: { leadId: lead.id, auditId: job.payload.auditId }, traceId: job.traceId, leadId: lead.id });
};

/** Visual-assessment findings (short strings) for the model to reference truthfully. */
function visualFindingStrings(audit: WebsiteAudit): string[] {
  return (audit.visualAssessment?.findings ?? []).map((f) => f.detail);
}

/** One-line Lighthouse perf/a11y/seo summary, or null when no scores exist. */
function lighthouseSummary(audit: WebsiteAudit): string | null {
  const l = audit.lighthouse;
  return l ? `perf ${l.performance ?? "n/a"}, a11y ${l.accessibility ?? "n/a"}, seo ${l.seo ?? "n/a"}` : null;
}

/**
 * Optionally replace a template draft's copy with Opus-personalized copy.
 * The LLM adapter returns null with no key / in dry-run (local) — so the
 * template is used unchanged. When real copy comes back, the opt-out line is
 * GUARANTEED at the bottom (appended if missing) and the Cornell + mockup
 * claims are enforced by validateDraft; any miss falls back to the template,
 * so a generation can never drop a required line.
 */
async function applyOpusCopy(
  ctx: AppContext,
  base: OutreachDraft,
  req: Omit<OutreachCopyRequest, "variant">,
  traceId: string,
): Promise<OutreachDraft> {
  const ticket = operationalTicket(ctx, "llm.generateOutreachCopy", { type: "OutreachDraft", id: base.id, leadId: base.leadId }, traceId, credentialFor(ctx, "anthropic"));
  const copy = await ctx.integrations.llm.generateOutreachCopy(ticket, { ...req, variant: base.variant });
  if (!copy) return base;
  let body = copy.body.trim();
  if (!body.includes(OPT_OUT_LINE)) body = `${body}\n\n${OPT_OUT_LINE}`;
  const subject = copy.subject.trim().length > 0 && copy.subject.trim().length <= 70 ? copy.subject.trim() : base.subject;
  const candidate: OutreachDraft = {
    ...base,
    subject,
    body,
    personalizationNotes: [...base.personalizationNotes, `copy generated by ${copy.generatedBy}`],
  };
  return validateDraft(candidate).length === 0 ? candidate : base;
}

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

  // A running outreach_variant experiment assigns the copy variant (deterministic per lead).
  const experiment = runningExperiment(ctx, "outreach_variant");
  const baseDraft = createFirstTouchDraft({
    lead,
    company,
    contact,
    audit,
    variant: experiment ? assignVariant(experiment, lead.id) : undefined,
    traceId: job.traceId,
  });
  // Opus-personalize the copy when available (template otherwise); the variant,
  // opt-out line, Cornell + mockup claims, and experiment wiring are preserved.
  const draft = await applyOpusCopy(
    ctx,
    baseDraft,
    {
      kind: "first_touch",
      companyName: company.name,
      niche: lead.niche,
      firstName: contact.name?.split(/\s+/)[0] ?? null,
      websiteUrl: lead.websiteUrl,
      hasWebsite: audit.hasWebsite,
      auditFindings: audit.outreachAngles.slice(0, 3),
      visualFindings: visualFindingStrings(audit),
      lighthouseSummary: lighthouseSummary(audit),
    },
    job.traceId,
  );
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

  // Touch-cap re-check at send time: even duplicate approved follow-up drafts
  // can never push a lead past MAX_TOUCHES total emails.
  if (draft.variant.startsWith("followup-")) {
    const sentCount = ctx.store.outreachDrafts
      .list({ leadId: lead.id })
      .filter((d) => d.status === "sent" || d.status === "sent_dry_run").length;
    if (sentCount >= MAX_TOUCHES) {
      ctx.store.outreachDrafts.save({ ...draft, status: "rejected" });
      ctx.store.writeActivity(lead.id, "follow_up_skipped", `Send refused: already at ${sentCount} touches (max ${MAX_TOUCHES})`, { traceId: job.traceId });
      return;
    }
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

  // A delivery email closes the loop: the lead is a customer, and there is
  // nothing to follow up on or close out. Only prospecting touches schedule those.
  if (draft.variant === DELIVERY_VARIANT) {
    setLeadStatus(ctx, lead, "customer");
    ctx.store.writeActivity(lead.id, "delivery_sent", result.detail, { traceId: job.traceId, byApproval: true });
    return;
  }

  setLeadStatus(ctx, lead, "contacted");
  ctx.store.writeActivity(lead.id, "outreach_sent", result.detail, { traceId: job.traceId, byApproval: true });

  // Schedule the no-response follow-up check (first touch → #1 at ~3.5 days,
  // follow-up #1 → #2 at ~9 days; nothing after #2). The check re-screens
  // everything at fire time, so a reply/unsubscribe in the meantime wins.
  const upcoming = nextFollowUp(draft.variant);
  if (upcoming) {
    ctx.store.queue.enqueue({
      type: "outreach.followup",
      payload: { leadId: lead.id, sequence: upcoming.sequence },
      traceId: job.traceId,
      leadId: lead.id,
      delayMs: Math.round(upcoming.delayDays * 24 * 3600_000),
    });
  }
  // Every send also schedules a close-out check: 14+ days of silence after
  // the LAST touch marks the lead not interested (a later send supersedes).
  ctx.store.queue.enqueue({
    type: "outreach.close",
    payload: { leadId: lead.id, sentAt: now },
    traceId: job.traceId,
    leadId: lead.id,
    delayMs: NO_RESPONSE_CLOSE_DAYS * 24 * 3600_000,
  });
};

/**
 * Fires ~14 days after a send. Silence after the sequence has ended = the
 * lead is marked not_interested and never contacted again. Follow-ups are
 * not the main business — silent leads exit the pipeline cleanly.
 */
const handleOutreachClose: JobHandler = async (ctx, job) => {
  const lead = ctx.store.leads.get(job.payload.leadId as string);
  if (!lead || lead.status !== "contacted") return; // replied / converted / already closed
  const decisive = ctx.store.replyEvents.list({ leadId: lead.id }).some((r) => r.intent !== "auto_reply");
  if (decisive) return;
  const sentAtCutoff = String(job.payload.sentAt ?? "");
  const drafts = ctx.store.outreachDrafts.list({ leadId: lead.id });
  // A later send scheduled its own close check; a follow-up still awaiting
  // the owner's decision means the sequence isn't over yet.
  if (drafts.some((d) => d.sentAt && d.sentAt > sentAtCutoff)) return;
  if (drafts.some((d) => d.variant.startsWith("followup-") && d.status === "pending_approval")) return;
  setLeadStatus(ctx, lead, "not_interested", `No response ${NO_RESPONSE_CLOSE_DAYS}+ days after last touch`);
  ctx.store.writeActivity(
    lead.id,
    "lead_closed_no_response",
    `No response ${NO_RESPONSE_CLOSE_DAYS}+ days after the last touch — marked not interested. No further outreach.`,
    { traceId: job.traceId },
  );
};

/**
 * Delayed no-response check. Drafts a follow-up ONLY if the lead still
 * qualifies (see evaluateFollowUp for the owner's keep/skip rules); every
 * skip is recorded, and any follow-up still requires owner approval before
 * it can send. Warm replies always win: a reply flips the lead off
 * "contacted" status, which kills the sequence here.
 */
const handleFollowUp: JobHandler = async (ctx, job) => {
  const lead = ctx.store.leads.get(job.payload.leadId as string);
  if (!lead) return;
  const sequence = (Number(job.payload.sequence) === 2 ? 2 : 1) as 1 | 2;
  const skip = (reasons: string[]) =>
    ctx.store.writeActivity(lead.id, "follow_up_skipped", `Follow-up #${sequence} skipped: ${reasons.join("; ")}`, { traceId: job.traceId });

  // Absolute screen first — DNC/unsubscribe (incl. spam-complaint webhooks) win over everything.
  const contact = ctx.store.contacts.list({ leadId: lead.id })[0] ?? null;
  const screen = screenForContactability(ctx.store, lead.identityKeys, contact?.email);
  if (screen.blocked) {
    skip(screen.reasons);
    return;
  }

  const drafts = ctx.store.outreachDrafts.list({ leadId: lead.id });
  // Idempotency: a re-enqueued/retried job must never draft the same bump twice.
  if (drafts.some((d) => d.variant === `followup-${sequence}`)) {
    skip([`follow-up #${sequence} already drafted`]);
    return;
  }
  const audit = ctx.store.audits.list({ leadId: lead.id })[0] ?? null;
  const verdict = evaluateFollowUp({
    lead,
    score: ctx.store.leadScores.list({ leadId: lead.id })[0] ?? null,
    audit,
    contact,
    replies: ctx.store.replyEvents.list({ leadId: lead.id }),
    sequence,
    priorTouchCount: drafts.filter(
      (d) =>
        d.status === "sent" ||
        d.status === "sent_dry_run" ||
        (d.variant.startsWith("followup-") && d.status === "pending_approval"),
    ).length,
  });
  if (!verdict.eligible) {
    skip(verdict.skipReasons);
    return;
  }

  const company = ctx.store.companies.get(lead.companyId);
  if (!company || !audit || !contact) {
    skip(["draft inputs missing (company/audit/contact)"]);
    return;
  }
  const baseDraft = createFollowUpDraft({ lead, company, contact, audit, sequence, traceId: job.traceId });
  const draft = await applyOpusCopy(
    ctx,
    baseDraft,
    {
      kind: "follow_up",
      companyName: company.name,
      niche: lead.niche,
      firstName: contact.name?.split(/\s+/)[0] ?? null,
      websiteUrl: lead.websiteUrl,
      hasWebsite: audit.hasWebsite,
      auditFindings: audit.outreachAngles.slice(0, 3),
      visualFindings: visualFindingStrings(audit),
      lighthouseSummary: lighthouseSummary(audit),
      sequence,
    },
    job.traceId,
  );
  const problems = validateDraft(draft);
  if (problems.length > 0) throw new Error(`Follow-up draft failed content rules: ${problems.join(", ")}`);

  // Same human-approval gate as every outbound outreach email. DECIDED
  // (phase E): follow-ups keep sharing SEND_FIRST_TOUCH — same risk class
  // (outbound email to a prospect), each draft still gets its own approval,
  // and one autopilot policy intentionally covers the whole sequence.
  // Revisit only if the owner wants follow-ups on a separate autopilot.
  const approval = requestApproval(ctx, {
    gate: "SEND_FIRST_TOUCH",
    subjectType: "OutreachDraft",
    subjectId: draft.id,
    leadId: lead.id,
    title: `Follow-up #${sequence} to ${contact.email} (${company.name})`,
    detail: `Subject: ${draft.subject}\n\n${draft.body}`,
    traceId: job.traceId,
  });
  ctx.store.outreachDrafts.insert({ ...draft, status: "pending_approval", approvalRequestId: approval.id });
  ctx.store.writeActivity(lead.id, "follow_up_drafted", `Follow-up #${sequence} awaiting owner approval in Review Queue`, { traceId: job.traceId });
};

/** Processes an inbound reply (webhook or manual). Reply text is DATA, never instructions. */
const handleReply: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  const text = String(job.payload.text ?? "");
  const provider = (job.payload.provider as "instantly" | "gmail" | "manual") ?? "manual";
  // The deterministic regex is authoritative; the LLM is consulted ONLY for
  // genuinely ambiguous ("unknown") replies and can never override a stop signal
  // (classifyReplyAssisted short-circuits on any confident regex label). The
  // reply text enters the prompt strictly as quoted data to label (invariant 1);
  // the ticket below is only minted when the assist actually runs.
  const classification = await classifyReplyAssisted(text, async (replyText) => {
    const ticket = operationalTicket(ctx, "llm.classifyReply", { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId, credentialFor(ctx, "anthropic"));
    return ctx.integrations.llm.classifyReply(ticket, { text: replyText });
  });

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
      const ticket = operationalTicket(ctx, "instantly.pauseLead", { type: "CampaignSync", id: sync.id, leadId: lead.id }, job.traceId, credentialFor(ctx, "instantly"));
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
      const ticket = operationalTicket(ctx, "calendar.freeBusy", { type: "Opportunity", id: opportunity.id, leadId: lead.id }, job.traceId, credentialFor(ctx, "calendar"));
      const suggestion = await suggestCall(lead, "Positive reply — discovery call recommended", ctx.integrations.calendar, ticket, opportunity.id);
      ctx.store.callSuggestions.insert(suggestion);
      // Business head (default): generate a build brief for the owner. With the
      // builder re-enabled, fall back to building a preview artifact himself.
      const nextJob = ctx.config.williamBuildsWebsites ? "preview.build" : "brief.generate";
      ctx.store.queue.enqueue({ type: nextJob, payload: { leadId: lead.id, opportunityId: opportunity.id }, traceId: job.traceId, leadId: lead.id });
      break;
    }
    case "negative": {
      // They said no — stop forever. Follow-ups and re-intake both respect this.
      setLeadStatus(ctx, lead, "not_interested", "Lead declined by reply");
      break;
    }
    case "auto_reply": {
      // Out-of-office is not a response: leave the lead "contacted" so the
      // follow-up sequence's timing is unaffected (per owner spec).
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
    websiteBriefId: null,
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

/**
 * Business-head path (default): on a positive reply, generate a WebsiteBrief —
 * a full build prompt for the OWNER to run on Fable 5 / Opus 4.8. Scrape + LLM
 * are operational reads (audited, ungated); the lead's site, audit weaknesses,
 * and business facts are QUOTED MATERIAL (invariant 1), never instructions.
 */
const handleBriefGenerate: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  const company = ctx.store.companies.get(lead.companyId);
  if (!company) throw new Error("Company missing");
  const audit = ctx.store.audits.list({ leadId: lead.id })[0] ?? null;
  const opportunityId = (job.payload.opportunityId as string) ?? null;

  // Audit weaknesses become the build prompt's fix-list.
  const weaknesses = audit ? audit.weaknesses.map((w) => `${w.detail} (${w.category}, ${w.severity})`) : [];

  // Audit-derived hints let the scrape synthesize real facts with zero network.
  const hints: CompanyScrapeHints = {
    companyName: company.name,
    niche: company.niche,
    services: audit?.extracted.services ?? [],
    contactEmails: audit?.extracted.contactEmails ?? [],
    phones: audit?.extracted.phones ?? [],
    socialLinks: audit?.extracted.socialLinks ?? {},
    about: company.description || undefined,
  };

  const scrapeTicket = operationalTicket(ctx, "firecrawl.scrapeCompany", { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId, credentialFor(ctx, "firecrawl"));
  const companyFacts = await ctx.integrations.firecrawl.scrapeCompany(scrapeTicket, lead.websiteUrl ?? "", hints);

  const llmTicket = operationalTicket(ctx, "llm.generateBuildPrompt", { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId, credentialFor(ctx, "anthropic"));
  const result = await ctx.integrations.llm.generateBuildPrompt(llmTicket, {
    companyName: company.name,
    niche: company.niche,
    websiteUrl: lead.websiteUrl,
    weaknesses,
    companyFacts,
  });

  const now = nowIso();
  const brief: WebsiteBrief = {
    id: newId("wbf"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    opportunityId,
    websiteUrl: lead.websiteUrl,
    weaknesses,
    companyFacts,
    buildPrompt: result.buildPrompt,
    recommendedStack: result.recommendedStack,
    targetModel: "fable-5",
    generatedBy: result.generatedBy,
    repoUrl: null,
    status: "ready",
  };
  ctx.store.websiteBriefs.insert(brief);
  ctx.store.writeActivity(
    lead.id,
    "owner_notification",
    `📋 Website brief ready for ${company.name} — paste the build prompt into Fable/Opus to build, then mark the site ready with the repo URL.`,
    { traceId: job.traceId, data: { websiteBriefId: brief.id } },
  );
};

const handlePreviewBuild: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  if (!ctx.config.williamBuildsWebsites) {
    ctx.store.writeActivity(lead.id, "builder_disabled", `Preview build skipped. ${BUILDER_DISABLED_NOTE}`, { traceId: job.traceId });
    return;
  }
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

  // Preview deploys are owner-triggered only (POST /api/site-projects/:id/
  // deploy-preview → deploy.preview job). This build job is reachable from
  // webhook-originated positive replies, so it must never reach an external
  // host on its own (compliance advisory D4, resolved phase E).
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
  if (!ctx.config.williamBuildsWebsites) {
    ctx.store.writeActivity(project.leadId, "builder_disabled", `Revision skipped. ${BUILDER_DISABLED_NOTE}`, { traceId: job.traceId });
    return;
  }

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
  if (!ctx.config.williamBuildsWebsites) {
    ctx.store.writeActivity(project.leadId, "builder_disabled", `Production deploy skipped. ${BUILDER_DISABLED_NOTE} Shipping the owner's finished repo goes through site.ship.`, { traceId: job.traceId });
    return;
  }
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

/**
 * Owner-triggered preview deploy (operational: audited, ungated — production
 * stays behind DEPLOY_PRODUCTION). The ticket carries the vercel credential
 * status, so it executes for real only outside local with credentials present
 * (engine rules); otherwise it simulates.
 */
const handleDeployPreview: JobHandler = async (ctx, job) => {
  const project = ctx.store.siteProjects.get(job.payload.siteProjectId as string);
  if (!project) throw new Error(`SiteProject ${job.payload.siteProjectId} not found`);
  if (!ctx.config.williamBuildsWebsites) {
    ctx.store.writeActivity(project.leadId, "builder_disabled", `Preview deploy skipped. ${BUILDER_DISABLED_NOTE}`, { traceId: job.traceId });
    return;
  }
  const lead = ctx.store.leads.get(project.leadId);
  const company = lead ? ctx.store.companies.get(lead.companyId) : null;
  const sourcePath = project.buildPath ?? (project.previewPath ? dirname(project.previewPath) : null);
  if (!sourcePath) throw new Error("Preview deploy blocked: project has no build or preview artifact");

  const vercelCred = ctx.store.credentialStatuses.findByKey("integration:vercel")[0] ?? null;
  const ticket = operationalTicket(
    ctx,
    "vercel.deployPreview",
    { type: "SiteProject", id: project.id, leadId: project.leadId },
    job.traceId,
    vercelCred ? { mode: vercelCred.mode } : null,
  );
  const result = await ctx.integrations.vercel.deploy(ticket, {
    target: "preview",
    projectName: deployProjectName(company?.name ?? project.leadId),
    sourcePath,
  });
  recordDeployment(ctx, project, "preview", result, null);
  if (result.ok && result.url) {
    ctx.store.siteProjects.save({ ...project, previewUrl: result.url, updatedAt: nowIso() });
  }
  ctx.store.writeActivity(
    project.leadId,
    "preview_deployed",
    result.dryRun
      ? `Preview deploy SIMULATED (dry-run): ${result.detail ?? ""}`
      : result.ok
        ? `Preview deployed: ${result.url ?? "(url pending)"}`
        : `Preview deploy FAILED: ${result.detail ?? "unknown"}`,
    { traceId: job.traceId },
  );
};

/**
 * Business-head shipping: the owner built the site and submitted its repo URL.
 * Enqueued only when a DEPLOY_PRODUCTION approval is granted (subject = the
 * WebsiteBrief). Records the repo, deploys it to production (dry-run now; real
 * repo/git-source deploy is credential-gated), and drafts the delivery email.
 */
const handleSiteShip: JobHandler = async (ctx, job) => {
  const brief = ctx.store.websiteBriefs.get(job.payload.websiteBriefId as string);
  if (!brief) throw new Error(`WebsiteBrief ${job.payload.websiteBriefId} not found`);
  const lead = ctx.store.leads.get(brief.leadId);
  const company = lead ? ctx.store.companies.get(lead.companyId) : null;
  if (!brief.repoUrl) throw new Error("Ship blocked: no repo URL on the brief");

  const decision = evaluateGate(ctx, {
    gate: "DEPLOY_PRODUCTION",
    subjectType: "WebsiteBrief",
    subjectId: brief.id,
    leadId: brief.leadId,
    traceId: job.traceId,
  });
  if (!decision.allowed || !decision.ticket) throw new Error(`Ship blocked: ${decision.reason}`);

  // Deploy the owner's finished repo. Reuses the Vercel adapter with the repo
  // URL as the source; real git-source deploy is credential-gated (OwnerRequest).
  const result = await ctx.integrations.vercel.deploy(decision.ticket, {
    target: "production",
    projectName: deployProjectName(company?.name ?? brief.leadId),
    sourcePath: brief.repoUrl,
  });

  const now = nowIso();
  ctx.store.deployments.insert({
    id: newId("dpl"),
    createdAt: now,
    updatedAt: now,
    siteProjectId: null,
    websiteBriefId: brief.id,
    target: "production",
    provider: "vercel",
    status: result.dryRun ? "dry_run" : result.ok ? "deployed" : "failed",
    url: result.url ?? null,
    branch: null,
    approvalRequestId: (job.payload.approvalRequestId as string) ?? null,
    qualityChecks: null,
    rollbackOf: null,
    errorLog: result.ok ? null : (result.detail ?? "unknown error"),
    deployedAt: result.ok && !result.dryRun ? now : null,
  });

  if (!result.ok) {
    ctx.memory.recordFailure({
      traceId: job.traceId,
      leadId: brief.leadId,
      jobId: job.id,
      category: "integration_error",
      message: `Ship deploy failed: ${result.detail ?? "unknown"}`,
      stack: null,
      retryable: true,
    });
    ctx.store.writeActivity(brief.leadId, "ship_failed", `Ship FAILED: ${result.detail ?? "unknown"}`, { traceId: job.traceId, byApproval: true });
    return;
  }

  ctx.store.websiteBriefs.save({ ...brief, status: "shipped" });
  ctx.store.writeActivity(
    brief.leadId,
    "site_shipped",
    result.dryRun
      ? `Site ship SIMULATED (dry-run) from ${brief.repoUrl}: ${result.detail ?? ""}`
      : `Site LIVE at ${result.url ?? "(url pending)"} (from ${brief.repoUrl})`,
    { traceId: job.traceId, byApproval: true },
  );
  // Draft the delivery email for the owner to approve.
  ctx.store.queue.enqueue({
    type: "outreach.delivery",
    payload: { leadId: brief.leadId, websiteBriefId: brief.id, liveUrl: result.url ?? null },
    traceId: job.traceId,
    leadId: brief.leadId,
  });
};

/** Drafts the post-ship delivery email (SEND_FIRST_TOUCH gate, owner-approved). */
const handleDeliveryDraft: JobHandler = async (ctx, job) => {
  const lead = getLead(ctx, job);
  const company = ctx.store.companies.get(lead.companyId);
  const contact = ctx.store.contacts.list({ leadId: lead.id })[0];
  if (!company || !contact?.email) throw new Error("Delivery draft inputs missing (company/contact)");

  // Re-screen — never email an opted-out contact, even a customer.
  const screen = screenForContactability(ctx.store, lead.identityKeys, contact.email);
  if (screen.blocked) {
    ctx.store.writeCompliance("dnc_blocked", `Delivery email refused: ${screen.reasons.join("; ")}`, { leadId: lead.id, traceId: job.traceId });
    return;
  }

  const draft = createDeliveryDraft({
    lead,
    company,
    contact,
    liveUrl: (job.payload.liveUrl as string) ?? null,
    traceId: job.traceId,
  });
  const problems = validateDraft(draft);
  if (problems.length > 0) throw new Error(`Delivery draft failed content rules: ${problems.join(", ")}`);

  const approval = requestApproval(ctx, {
    gate: "SEND_FIRST_TOUCH",
    subjectType: "OutreachDraft",
    subjectId: draft.id,
    leadId: lead.id,
    title: `Delivery email to ${contact.email} (${company.name})`,
    detail: `Subject: ${draft.subject}\n\n${draft.body}`,
    traceId: job.traceId,
  });
  ctx.store.outreachDrafts.insert({ ...draft, status: "pending_approval", approvalRequestId: approval.id });
  ctx.store.writeActivity(lead.id, "delivery_drafted", `Delivery email awaiting owner approval in Review Queue`, { traceId: job.traceId });
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

/**
 * Owner-provided transcript/notes → durable lessons. The text is DATA
 * (invariant 1): it is scanned for insights and stored, never executed and
 * never placed in a prompt as instructions.
 */
const handleTranscriptIngest: JobHandler = async (ctx, job) => {
  const source = String(job.payload.source ?? "unknown");
  const text = String(job.payload.text ?? "");
  // Prefer the LLM extractor when available; the transcript text enters the
  // prompt strictly as quoted data (invariant 1). The mock and the real adapter
  // under dry-run (always local) return null, so local falls back to the
  // deterministic keyword extractor — behavior unchanged with no key.
  const ticket = operationalTicket(ctx, "llm.extractTranscriptInsights", { type: "Transcript", id: source, leadId: null }, job.traceId, credentialFor(ctx, "anthropic"));
  const insights =
    (await ctx.integrations.llm.extractTranscriptInsights(ticket, { source, text })) ??
    (await ctx.integrations.transcripts.extractInsights({ source, text }));

  // Derived from the schema enum so the two can never drift (advisory).
  const validTopics = new Set<string>(DurableLesson.shape.topic.options);
  for (const insight of insights) {
    const topic = (validTopics.has(insight.topic) ? insight.topic : "other") as Parameters<typeof ctx.memory.addLesson>[0]["topic"];
    ctx.memory.addLesson({ topic, lesson: insight.insight, evidence: [`transcript:${source}`] });
  }
  ctx.store.writeAudit({
    traceId: job.traceId,
    actor: "system",
    action: "transcript.ingested",
    subjectType: "Transcript",
    subjectId: source,
    leadId: null,
    gate: null,
    outcome: "recorded",
    detail: `${insights.length} insight(s) from ${source} (${text.length} chars)${insights.length === 0 ? " — nothing matched; lessons need full sentences about design/layout/conversion" : ""}`,
  });
};

/**
 * Poll Instantly's /emails API for inbound replies (free alternative to the
 * Hypergrowth-gated webhook). Each polled message is DATA: it can only enqueue
 * the fixed reply.process handler — never executed, never placed in a prompt
 * (invariant 1). Ungated read; dry-run in local. Dedupes against persisted
 * replyEvents by provider message id (the serial FIFO queue guarantees the
 * prior reply.process has run before the next poll job).
 */
const handlePollReplies: JobHandler = async (ctx, job) => {
  const ticket = operationalTicket(ctx, "instantly.pollInbound", { type: "InboundPoll", id: "instantly", leadId: null }, job.traceId, credentialFor(ctx, "instantly"));
  const inbound = await ctx.integrations.instantly.pollInbound(ticket, { limit: 100 });
  let enqueued = 0;
  for (const msg of inbound) {
    const contact = ctx.store.contacts.findByKey(`email:${msg.fromEmail.toLowerCase()}`)[0];
    const leadId = contact?.leadId;
    if (!leadId) continue; // not one of our leads — ignore, same as the webhook
    const seen = ctx.store.replyEvents.list({ leadId }).some((r) => r.externalMessageId === msg.externalMessageId);
    if (seen) continue;
    ctx.store.queue.enqueue({
      type: "reply.process",
      payload: { leadId, text: msg.text, provider: "instantly", externalMessageId: msg.externalMessageId },
      traceId: newTraceId(),
      leadId,
    });
    enqueued++;
  }
  ctx.log.info("instantly poll complete", { fetched: inbound.length, enqueued, traceId: job.traceId });
};

// ─── Lead sourcing controller ─────────────────────────────────────────────────

const QUALIFIED_MIN_SCORE = 35;
const MAX_SOURCING_CHECKS = 300;

/**
 * Self-re-enqueuing controller for automatic lead sourcing.
 *
 * Each invocation:
 *   1. Re-counts qualified leads (draft + score > 35).
 *   2. Stops if target met, candidate cap hit, or checks exceeded.
 *   3. Waits (re-enqueues) if prior-page leads are still in-flight.
 *   4. Pages Places for the next batch, ingests businesses, re-enqueues.
 *
 * Invariant 2: the Places call is gated behind ACTIVATE_NEW_LEAD_SOURCE.
 * Invariant 3: local env → Places adapter returns [] (dry-run); no real calls.
 */
const handleLeadSource: JobHandler = async (ctx, job) => {
  const run = ctx.store.sourcingRuns.get(job.payload.sourcingRunId as string);
  if (!run || run.status !== "running") return;

  const reEnqueue = () =>
    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: job.traceId,
      delayMs: ctx.config.leadSourcing.recheckDelayMs,
    });

  const stop = (status: SourcingRunStatus, note: string) =>
    ctx.store.sourcingRuns.save({ ...run, status, resultNote: note, updatedAt: nowIso() });

  // 1) Re-count qualified and increment the check counter.
  const qualifiedCount = countQualified(ctx, run.leadIds, QUALIFIED_MIN_SCORE);
  const checks = run.checks + 1;
  ctx.store.sourcingRuns.save({ ...run, qualifiedCount, checks, updatedAt: nowIso() });

  // Reload so subsequent mutations are based on fresh state.
  const updated = ctx.store.sourcingRuns.get(run.id)!;

  // 2) Stop conditions (checked in priority order).
  if (qualifiedCount >= run.target) {
    stop("completed", `Found ${qualifiedCount} qualified lead(s).`);
    return;
  }
  if (updated.candidatesIngested >= run.candidateCap) {
    stop("stopped_cap", `Hit candidate cap (${run.candidateCap}) — found ${qualifiedCount} of ${run.target}.`);
    return;
  }
  if (checks > MAX_SOURCING_CHECKS) {
    stop("failed", `Stopped after ${checks} checks — found ${qualifiedCount} of ${run.target}.`);
    return;
  }

  // 3) If prior-page leads are still flowing through the pipeline, wait.
  const inFlight = updated.leadIds.some((id) => {
    const l = ctx.store.leads.get(id);
    return l ? !leadResolved(l) : false;
  });
  if (inFlight) {
    reEnqueue();
    return;
  }

  // 4) Source the next page from Places (gated).
  const decision = evaluateGate(ctx, {
    gate: "ACTIVATE_NEW_LEAD_SOURCE",
    subjectType: "SourcingRun",
    subjectId: run.id,
    traceId: job.traceId,
  });
  if (!decision.allowed || !decision.ticket) {
    stop("failed", `Lead-source gate denied: ${decision.reason}`);
    return;
  }

  const page = await ctx.integrations.places.searchBusinesses(decision.ticket, {
    query: nicheSearchQuery(run.niche, run.location),
    location: run.location,
    pageToken: updated.nextPageToken,
  });

  if (page.businesses.length === 0) {
    stop("stopped_exhausted", `No more results — found ${qualifiedCount} of ${run.target}.`);
    return;
  }

  // Ingest businesses up to the remaining capacity.
  const remaining = run.candidateCap - updated.candidatesIngested;
  const newLeadIds: string[] = [];
  for (const biz of page.businesses.slice(0, remaining)) {
    const result = ingestLead(ctx, {
      companyName: biz.name,
      websiteUrl: biz.websiteUrl,
      niche: run.niche,
      city: biz.city,
      source: {
        kind: "google_maps",
        detail: `sourcing run ${run.id}`,
        importedAt: nowIso(),
        importedBy: "system",
      },
    });
    // Only count genuinely new leads; duplicates / DNC-blocked ones don't count.
    if (result.outcome === "created") newLeadIds.push(result.lead.id);
  }

  // Persist updated run state and re-enqueue for the next check cycle.
  ctx.store.sourcingRuns.save({
    ...updated,
    leadIds: [...updated.leadIds, ...newLeadIds],
    candidatesIngested: updated.candidatesIngested + newLeadIds.length,
    nextPageToken: page.nextPageToken,
    checks,
    qualifiedCount,
    updatedAt: nowIso(),
  });
  reEnqueue();
};

export const JOB_HANDLERS: Record<string, JobHandler> = {
  "lead.audit": handleAudit,
  "lead.score": handleScore,
  "lead.contact": handleContact,
  "outreach.draft": handleDraft,
  "outreach.send": handleSend,
  "outreach.followup": handleFollowUp,
  "outreach.close": handleOutreachClose,
  "reply.process": handleReply,
  "instantly.pollReplies": handlePollReplies,
  "brief.generate": handleBriefGenerate,
  "preview.build": handlePreviewBuild,
  "site.revise": handleSiteRevise,
  "deploy.production": handleDeployProduction,
  "deploy.preview": handleDeployPreview,
  "site.ship": handleSiteShip,
  "outreach.delivery": handleDeliveryDraft,
  "billing.draft": handleBillingDraft,
  "billing.execute": handleBillingExecute,
  "ingest.transcript": handleTranscriptIngest,
  "lead.source": handleLeadSource,
};
