import {
  companyIdentityKey,
  bestBusinessEmail,
  identityKeys,
  isPlaceholderEmail,
  isTopTierContact,
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
  type Lead,
  type Niche,
  type OutreachDraft,
  type SourceProvenance,
  type SourcingRunStatus,
  type VisualAssessment,
  type WebsiteAudit,
} from "@william/core";
import { readFileSync } from "node:fs";
import { auditWebsite, crawlForEmail, fetchHomepageEmails, launchChromium, lighthouseSlowAngle, runDeferredLighthouse } from "@william/worker-site-auditor";
import {
  OPT_OUT_LINE,
  createFirstTouchDraft,
  screenForContactability,
  validateDraft,
} from "@william/worker-outreach";
import { decideApproval, requestApproval } from "./approvals";
import { credentialFor, evaluateGate, localReadCredential, operationalTicket, type AppContext } from "./context";
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

  ctx.store.queue.enqueue({ type: "lead.contact", payload: { leadId: lead.id }, traceId, leadId: lead.id });
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
  ctx.store.queue.enqueue({ type: "lead.score", payload: { leadId: lead.id, auditId: audit.id }, traceId: job.traceId, leadId: lead.id });
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
  if (result.score <= ctx.config.outreachScoreThreshold) {
    setLeadStatus(ctx, lead, "scored");
    ctx.store.writeActivity(lead.id, "below_threshold", `Score ${result.score} not above threshold ${ctx.config.outreachScoreThreshold} — kept, not emailed`, { traceId: job.traceId });
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
  const existing = ctx.store.contacts.list({ leadId: lead.id })[0];
  let contact: Contact | undefined = existing;

  if (!contact) {
    const emailCtx = { siteUrl: lead.websiteUrl, companyName: ctx.store.companies.get(lead.companyId)?.name ?? null };

    // 1) Cheap homepage pass — plain HTTP GET, no browser. Dry-run safe (returns []
    //    in local). Runs BEFORE the Playwright crawl to avoid spinning up Chromium
    //    for leads whose contact email is already visible in the homepage source.
    const homepageTicket = operationalTicket(ctx, "homepage.fetch", { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId, localReadCredential(ctx));
    const auditEmails = lead.websiteUrl
      ? await fetchHomepageEmails(lead.websiteUrl, { ticket: { dryRun: homepageTicket.dryRun }, companyName: emailCtx.companyName })
      : [];
    let resolvedEmail = bestBusinessEmail(auditEmails, emailCtx);
    let source: "website_published" | "website_crawled" | "enrichment" = "website_published";
    let foundOn: string | null = null;

    // 2) Playwright escalation — when the homepage gave us NOTHING, or only a
    //    non-top-tier address. A junk/off-domain homepage email must not shadow a
    //    real service address on /contact (the easlandscaping case), so we still
    //    crawl, rank across all pages, and keep whichever of homepage-best vs
    //    crawl-best ranks higher.
    // The operational ticket governs dry-run: in local it's a dry-run ticket, so
    //    crawlForEmail simulates and returns empty (no browser launch, zero
    //    network). `localReadCredential` returns sandbox/live unconditionally;
    //    that is safe ONLY because computeDryRun forces dry-run when env ===
    //    "local" BEFORE the credential is consulted (invariant 3).
    if (lead.websiteUrl && (!resolvedEmail || !isTopTierContact(resolvedEmail, emailCtx))) {
      const crawlTicket = operationalTicket(ctx, "site_audit.crawl", { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId, localReadCredential(ctx));
      const crawl = await crawlForEmail(lead, {
        log: ctx.log,
        ticket: crawlTicket,
        launchBrowser: ctx.browserLauncher ?? launchChromium,
        subpaths: ctx.config.emailDiscovery.subpaths,
        maxPages: ctx.config.emailDiscovery.maxPages,
        pageTimeoutMs: ctx.config.emailDiscovery.pageTimeoutMs,
        budgetMs: ctx.config.emailDiscovery.budgetMs,
        companyName: emailCtx.companyName,
      });
      if (crawl.email) {
        const better = bestBusinessEmail([resolvedEmail, crawl.email].filter((x): x is string => !!x), emailCtx);
        if (better === crawl.email && better !== resolvedEmail) {
          resolvedEmail = crawl.email; source = "website_crawled"; foundOn = crawl.foundOn ?? null;
        }
      }
    }

    // 3) An email resolved from the website (homepage pass or crawl) becomes the
    //    contact. We never GUESS an address (no info@<domain> fabrication): a lead
    //    with no real email found on its site is simply not contactable.
    //    phone is intentionally null here — phones come from the audit, which runs
    //    AFTER contact in the new order; they are re-derivable at audit time.
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
        phone: null,
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

  // Verify before outreach.
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
  // Enqueue the audit AFTER contact is resolved — no audit runs for uncontactable leads.
  ctx.store.queue.enqueue({ type: "lead.audit", payload: { leadId: lead.id }, traceId: job.traceId, leadId: lead.id });
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

  if (ctx.config.pushMode === "auto") {
    decideApproval(ctx, approval.id, "granted", "auto-push mode (PUSH_MODE=auto)", "system:auto_push");
    ctx.store.queue.enqueue({ type: "outreach.send", payload: { draftId: draft.id }, traceId: job.traceId, leadId: lead.id });
    ctx.store.writeActivity(lead.id, "auto_push", `Auto-push: send enqueued (DNC re-screened at send).`, { traceId: job.traceId });
  }
};

/** Enqueued by the API when the owner grants a SEND_FIRST_TOUCH approval. */
const handleSend: JobHandler = async (ctx, job) => {
  const draft = ctx.store.outreachDrafts.get(job.payload.draftId as string);
  if (!draft) throw new Error(`Draft ${job.payload.draftId} not found`);
  // Idempotency: a duplicate or RECLAIMED send job (the worker died after the
  // push but before recording) for an already-sent draft is a no-op — never
  // double-push to Instantly. Each touch is its own draft, so this only ever
  // suppresses a re-run of the same one.
  if (draft.status === "sent" || draft.status === "sent_dry_run") {
    ctx.store.writeActivity(draft.leadId, "send_skipped_duplicate", `Send re-run for already-sent draft ${draft.id} — ignored`, { traceId: job.traceId });
    return;
  }
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
  // A failed push must NOT be recorded as sent — throwing lets the queue retry
  // (then dead-letter) and keeps the lead in its pre-send state so the owner sees
  // it never went out, instead of a false "contacted". The draft stays unsent so
  // a retry re-attempts it (the idempotency guard only skips truly-sent drafts).
  if (!result.ok) {
    ctx.store.writeActivity(lead.id, "send_failed", `Instantly push failed — will retry: ${result.detail}`, { traceId: job.traceId });
    throw new Error(`Instantly push failed: ${result.detail}`);
  }
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

// ─── Lead sourcing controller ─────────────────────────────────────────────────

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

  // NOTE: `stop` re-fetches from the store at call time so the terminal record
  // always carries the freshest counters (qualifiedCount / checks /
  // candidatesIngested / leadIds written by the save just above this closure).
  // Spreading `run` (the original snapshot loaded at handler entry) would
  // revert those increments in the persisted terminal record.
  const stop = (status: SourcingRunStatus, note: string) => {
    const fresh = ctx.store.sourcingRuns.get(run.id) ?? run;
    ctx.store.sourcingRuns.save({ ...fresh, status, resultNote: note, updatedAt: nowIso() });
  };

  // Batch mode sweeps many niches up to the candidate cap; normal mode works
  // toward a qualified-lead target within a single niche.
  const sweeping = run.mode === "batch";

  // 1) Re-count qualified and increment the check counter.
  const qualifiedCount = countQualified(ctx, run.leadIds, ctx.config.outreachScoreThreshold);
  const checks = run.checks + 1;
  ctx.store.sourcingRuns.save({ ...run, qualifiedCount, checks, updatedAt: nowIso() });

  // Reload so subsequent mutations are based on fresh state.
  const updated = ctx.store.sourcingRuns.get(run.id)!;

  // 2) Stop conditions (checked in priority order).
  // Batch mode is cap-governed; the qualified-target stop is skipped.
  if (!sweeping && qualifiedCount >= run.target) {
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

  // 4) Determine the niche to query. In batch mode, sweep through nicheQueue;
  //    currentNiche is set after the first niche is exhausted.
  const niche = sweeping
    ? (run.currentNiche ?? run.nicheQueue[0] ?? run.niche)
    : run.niche;

  // 5) Source the next page from Places (gated).
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
    query: nicheSearchQuery(niche, run.location),
    location: run.location,
    pageToken: updated.nextPageToken,
  });

  if (page.businesses.length === 0) {
    if (sweeping) {
      // This niche is exhausted — advance to the next one in the queue.
      const rest = run.nicheQueue.filter((n) => n !== niche);
      if (rest.length === 0) {
        stop("stopped_exhausted", `Swept all niches — ${qualifiedCount} qualified, ${updated.candidatesIngested} ingested.`);
        return;
      }
      ctx.store.sourcingRuns.save({
        ...updated,
        currentNiche: rest[0]!,
        nicheQueue: rest,
        nextPageToken: null,
        checks,
        updatedAt: nowIso(),
      });
      reEnqueue();
      return;
    }
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
      niche,
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
  "lead.contact": handleContact,
  "lead.score": handleScore,
  "outreach.draft": handleDraft,
  "outreach.send": handleSend,
  "lead.source": handleLeadSource,
};
