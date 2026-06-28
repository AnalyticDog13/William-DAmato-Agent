import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newId, newTraceId, nowIso } from "@william/core";
import {
  createContext,
  decideApproval,
  ingestLead,
  runUntilEmpty,
  seedDemoData,
  generateDailyReport,
  type AppContext,
} from "../src/index";

const futureClock = () => new Date(Date.now() + 10 * 60_000);

let ctx: AppContext;
beforeEach(() => {
  ctx = createContext({ inMemory: true, silent: true });
});

const lead = (name: string, url: string | null = "https://test-biz.example.com", email?: string) => ({
  companyName: name,
  websiteUrl: url,
  niche: "barbershop" as const,
  city: "Ithaca",
  ...(email ? { email } : {}),
  source: { kind: "manual" as const, detail: "test", importedAt: nowIso(), importedBy: "owner" as const },
});

describe("send idempotency (reclaim safety)", () => {
  it("a re-run of an already-sent draft is a no-op (never double-pushes)", async () => {
    ingestLead(ctx, lead("Idem Biz", "https://idem-biz.example.com", "owner@idem-biz.example.com"));
    await runUntilEmpty(ctx, 100, futureClock);
    const approval = ctx.store.approvals.list({ status: "pending" })[0]!;
    decideApproval(ctx, approval.id, "granted", "test");
    ctx.store.queue.enqueue({ type: "outreach.send", payload: { draftId: approval.subjectId }, traceId: approval.traceId, leadId: approval.leadId });
    await runUntilEmpty(ctx, 100, futureClock);
    expect(ctx.store.campaignSyncs.count()).toBe(1);
    expect(ctx.store.outreachDrafts.get(approval.subjectId)!.status).toBe("sent_dry_run");

    // Worker died mid-job → the same send job is reclaimed and runs again.
    ctx.store.queue.enqueue({ type: "outreach.send", payload: { draftId: approval.subjectId }, traceId: approval.traceId, leadId: approval.leadId });
    await runUntilEmpty(ctx, 100, futureClock);
    expect(ctx.store.campaignSyncs.count()).toBe(1); // STILL one — no duplicate send
  });
});

describe("send failure handling", () => {
  it("a failed Instantly push does NOT mark the lead contacted — the job fails and retries", async () => {
    ingestLead(ctx, lead("Fail Biz", "https://fail-biz.example.com", "owner@fail-biz.example.com"));
    await runUntilEmpty(ctx, 100, futureClock);
    const approval = ctx.store.approvals.list({ status: "pending" })[0]!;
    decideApproval(ctx, approval.id, "granted", "test");
    // Instantly rejects the push (HTTP error / network failure → ok:false).
    ctx.integrations.instantly.pushLead = async () => ({ dryRun: false, ok: false, detail: "instantly.pushLead failed (HTTP 422): bad" });
    ctx.store.queue.enqueue({ type: "outreach.send", payload: { draftId: approval.subjectId }, traceId: approval.traceId, leadId: approval.leadId });
    await runUntilEmpty(ctx, 100, futureClock);

    expect(ctx.store.leads.get(approval.leadId!)!.status).not.toBe("contacted");
    expect(ctx.store.outreachDrafts.get(approval.subjectId)!.status).not.toBe("sent");
    expect(ctx.store.campaignSyncs.count()).toBe(0); // nothing recorded as a successful send
    const sendJob = ctx.store.queue.list().find((j) => j.type === "outreach.send")!;
    expect(sendJob.status).toBe("dead"); // surfaced as a failure (retried to exhaustion), not silently "sent"
  });
});

describe("lead pipeline (dry run, mocks)", () => {
  it("runs intake → audit → contact → score → draft and stops at approval", async () => {
    const result = ingestLead(ctx, lead("Test Barbers"));
    expect(result.outcome).toBe("created");
    await runUntilEmpty(ctx, 100, futureClock);

    const l = ctx.store.leads.list()[0]!;
    expect(["draft_ready", "disqualified"]).toContain(l.status);
    if (l.status === "draft_ready") {
      const draft = ctx.store.outreachDrafts.list({ leadId: l.id })[0]!;
      expect(draft.status).toBe("pending_approval");
      expect(draft.body).toMatch(/Cornell/);
      expect(draft.body).toMatch(/rather not hear from me/);
      // CRITICAL: nothing was sent.
      expect(ctx.store.campaignSyncs.count()).toBe(0);
    }
  });

  it("refuses duplicate leads by any identity key", () => {
    expect(ingestLead(ctx, lead("Test Barbers")).outcome).toBe("created");
    expect(ingestLead(ctx, lead("Test Barbers LLC", null)).outcome).toBe("duplicate");
    expect(ingestLead(ctx, lead("Different Name", "http://www.test-biz.example.com/home")).outcome).toBe("duplicate");
  });

  it("send without approval fails and never reaches the adapter", async () => {
    ingestLead(ctx, lead("Test Barbers"));
    await runUntilEmpty(ctx, 100, futureClock);
    const draft = ctx.store.outreachDrafts.list()[0];
    if (!draft) return; // disqualified path; covered elsewhere
    ctx.store.queue.enqueue({ type: "outreach.send", payload: { draftId: draft.id }, traceId: newTraceId(), leadId: draft.leadId });
    await runUntilEmpty(ctx, 100, futureClock);
    expect(ctx.store.campaignSyncs.count()).toBe(0);
    const failures = ctx.store.failures.list();
    expect(failures.some((f) => f.category === "policy_denied")).toBe(true);
  });

  it("approved send executes as dry-run and contacts the lead", async () => {
    ingestLead(ctx, lead("Test Barbers"));
    await runUntilEmpty(ctx, 100, futureClock);
    const approval = ctx.store.approvals.list({ status: "pending" })[0];
    if (!approval) return;
    decideApproval(ctx, approval.id, "granted", "test");
    ctx.store.queue.enqueue({ type: "outreach.send", payload: { draftId: approval.subjectId }, traceId: approval.traceId, leadId: approval.leadId });
    await runUntilEmpty(ctx, 100, futureClock);

    const sync = ctx.store.campaignSyncs.list()[0]!;
    expect(sync.status).toBe("dry_run"); // local env can NEVER send live
    expect(ctx.store.leads.get(approval.leadId!)?.status).toBe("contacted");
  });

  it("seed + full demo flow produces a coherent daily report", async () => {
    seedDemoData(ctx);
    await runUntilEmpty(ctx, 500, futureClock);
    const { memory, reportText } = generateDailyReport(ctx);
    expect(memory.metrics.leadsTotal).toBeGreaterThan(0);
    expect(reportText).toMatch(/Daily Report/);
    expect(ctx.store.ownerRequests.count({ status: "open" })).toBeGreaterThan(0);
  });
});

describe("pipeline reorder: contact before audit (task 13)", () => {
  it("intake enqueues lead.contact first (not lead.audit)", () => {
    const result = ingestLead(ctx, lead("Reorder Barbers", "https://reorder-barbers.example.com", "owner@reorder-barbers.example.com"));
    if (result.outcome !== "created") throw new Error("expected created");
    const l = result.lead;
    // Intake must enqueue lead.contact, NOT lead.audit.
    expect(ctx.store.queue.list().some((j) => j.type === "lead.contact" && j.payload.leadId === l.id)).toBe(true);
    expect(ctx.store.queue.list().some((j) => j.type === "lead.audit" && j.payload.leadId === l.id)).toBe(false);
  });

  it("contact with no email disqualifies and never enqueues a lead.audit job", async () => {
    // A website-less lead has NO email at every rung: fetchHomepageEmails (null URL → []),
    // crawl (null URL → skipped), enrichment (null domain → skipped) — email gate fires.
    const result = ingestLead(ctx, lead("No Email Barbers", null));
    if (result.outcome !== "created") throw new Error("expected created");
    const l = result.lead;

    const { JOB_HANDLERS } = await import("../src/pipelines");
    const contactJob = ctx.store.queue.list().find((j) => j.type === "lead.contact" && j.leadId === l.id)!;
    await JOB_HANDLERS["lead.contact"]!(ctx, contactJob);

    const lead_ = ctx.store.leads.get(l.id)!;
    expect(lead_.status).toBe("disqualified");
    expect(lead_.disqualifiedReason).toMatch(/no contactable email/i);
    expect(ctx.store.leads.get(l.id)).toBeDefined(); // record kept
    // No lead.audit was ever enqueued for this lead.
    expect(ctx.store.queue.list().some((j) => j.type === "lead.audit" && j.payload.leadId === l.id)).toBe(false);
    // No lead.score was ever enqueued either.
    expect(ctx.store.queue.list().some((j) => j.type === "lead.score" && j.leadId === l.id)).toBe(false);
  });

  it("contact that finds an email enqueues lead.audit (not lead.score)", async () => {
    // Owner-provided email means handleContact finds an existing contact, skips
    // discovery, verifies, sets contact_ready, and enqueues lead.audit.
    const result = ingestLead(ctx, lead("Email Found Barbers", "https://email-found.example.com", "owner@email-found.example.com"));
    if (result.outcome !== "created") throw new Error("expected created");
    const l = result.lead;

    const { JOB_HANDLERS } = await import("../src/pipelines");
    const contactJob = ctx.store.queue.list().find((j) => j.type === "lead.contact" && j.leadId === l.id)!;
    const auditsBefore = ctx.store.queue.list().filter((j) => j.type === "lead.audit" && j.payload.leadId === l.id).length;
    await JOB_HANDLERS["lead.contact"]!(ctx, contactJob);

    // A lead.audit job must have been enqueued (one MORE than before the handler ran).
    const auditsAfter = ctx.store.queue.list().filter((j) => j.type === "lead.audit" && j.payload.leadId === l.id);
    expect(auditsAfter.length).toBe(auditsBefore + 1);
    // No lead.score yet — score comes AFTER the audit, which hasn't run yet.
    expect(ctx.store.queue.list().some((j) => j.type === "lead.score" && j.payload.leadId === l.id)).toBe(false);
  });

  it("audit enqueues lead.score (not lead.contact)", async () => {
    // Run contact handler first (email found via owner-provided contact).
    const result = ingestLead(ctx, lead("Score Barbers", "https://score-barbers.example.com", "owner@score-barbers.example.com"));
    if (result.outcome !== "created") throw new Error("expected created");
    const l = result.lead;
    const { JOB_HANDLERS } = await import("../src/pipelines");
    const contactJob = ctx.store.queue.list().find((j) => j.type === "lead.contact" && j.leadId === l.id)!;
    await JOB_HANDLERS["lead.contact"]!(ctx, contactJob);

    // Now an audit job is enqueued. Run ONLY the audit handler.
    const auditJob = ctx.store.queue.list().find((j) => j.type === "lead.audit" && j.payload.leadId === l.id)!;
    expect(auditJob).toBeDefined();
    const contactJobsBefore = ctx.store.queue.list().filter((j) => j.type === "lead.contact" && j.leadId === l.id).length;
    await JOB_HANDLERS["lead.audit"]!(ctx, auditJob);

    // Audit must enqueue lead.score.
    expect(ctx.store.queue.list().some((j) => j.type === "lead.score" && j.payload.leadId === l.id)).toBe(true);
    // Audit must NOT enqueue any NEW lead.contact job (count unchanged).
    const contactJobsAfter = ctx.store.queue.list().filter((j) => j.type === "lead.contact" && j.leadId === l.id).length;
    expect(contactJobsAfter).toBe(contactJobsBefore);
  });

  it("no-email lead is disqualified via full pipeline — record kept, never reaches scoring", async () => {
    // Full runUntilEmpty path: intake → contact (hits the email gate, disqualifies).
    ingestLead(ctx, lead("No Email Full Barbers", null));
    await runUntilEmpty(ctx, 100, futureClock);
    const l = ctx.store.leads.list()[0]!;
    expect(ctx.store.leads.get(l.id)!.status).toBe("disqualified");
    expect(ctx.store.leads.get(l.id)!.disqualifiedReason).toMatch(/no contactable email/i);
    expect(ctx.store.leads.get(l.id)).toBeDefined(); // record kept
    // No lead.score job was ever enqueued.
    expect(ctx.store.queue.list().some((j) => j.type === "lead.score" && j.leadId === l.id)).toBe(false);
  });

  it("contactable lead: contact runs before audit and score, score finds the contact and enqueues outreach.draft", async () => {
    // Owner-provided email flows through: contact → audit → score → draft.
    ingestLead(ctx, lead("Full Pipeline Barbers", "https://full-pipeline.example.com", "owner@full-pipeline.example.com"));
    await runUntilEmpty(ctx, 100, futureClock);
    const l = ctx.store.leads.list()[0]!;
    if (l.status === "draft_ready" || l.status === "scored") {
      // Contact must have been created before scoring ran (and before audit).
      expect(ctx.store.contacts.list({ leadId: l.id })[0]).toBeDefined();
      // Score should exist (handleScore ran after the audit).
      expect(ctx.store.leadScores.list({ leadId: l.id })[0]).toBeDefined();
    }
    // The overall pipeline still stops at approval (same as before).
    expect(["draft_ready", "disqualified"]).toContain(l.status);
  });
});

describe("visual scoring in handleScore (task 9)", () => {
  // 1×1 transparent PNG, base64-decoded — the smallest valid PNG file.
  const TINY_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );

  // Temp dirs created by individual tests; removed after each so we never leak
  // PNGs into the OS temp dir (review: retrofit cleanup for the visual-fires dir).
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  // Get a real lead + audit through the normal pipeline (mock audit, http/mock mode
  // → screenshot paths are null), then drive lead.score directly so the test owns
  // the screenshot paths and the stub.
  // Email is owner-provided so contact resolves immediately and audit always runs
  // (no email discovery needed — the reorder means no audit without a contact).
  async function leadAndAudit(name: string) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    ingestLead(ctx, lead(name, `https://${slug}.example.com`, `owner@${slug}.example.com`));
    await runUntilEmpty(ctx, 100, futureClock);
    const l = ctx.store.leads.list()[0]!;
    const audit = ctx.store.audits.list({ leadId: l.id })[0]!;
    return { lead: l, audit };
  }

  function runScore(leadId: string, auditId: string) {
    return import("../src/pipelines").then(({ JOB_HANDLERS }) => {
      const now = nowIso();
      const job = {
        id: newId("job"),
        type: "lead.score",
        payload: { leadId, auditId },
        status: "running" as const,
        traceId: newTraceId(),
        leadId,
        runAt: now,
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      return JOB_HANDLERS["lead.score"]!(ctx, job);
    });
  }

  it("scores with the visual assessment when screenshots exist and persists it", async () => {
    // "Cold Visual Barbers" is a domain whose deterministic mock audit scores in
    // the COLD band (no SSL/mobile issues, mediocre Lighthouse) — i.e. the
    // pre-visual tier is NOT warm/hot. That makes the assertion below
    // unambiguous: only the visual layer can promote it.
    const { lead: l, audit } = await leadAndAudit("Cold Visual Barbers");

    // The pipeline already ran lead.score ONCE deterministically (no screenshots
    // → no visual). Capture that pre-visual score and prove it is below warm: if
    // it were already warm/hot the warm/hot assertion later would be vacuous.
    const preVisualScores = ctx.store.leadScores.list({ leadId: l.id });
    expect(preVisualScores.length).toBe(1);
    const preVisual = preVisualScores[0]!;
    expect(preVisual.tier).toBe("cold"); // deterministic-only verdict, pre-visual

    // Write a real PNG and point the audit's first page at it (desktop + mobile).
    const dir = mkdtempSync(join(tmpdir(), "william-visual-"));
    tempDirs.push(dir);
    const shot = join(dir, "desktop.png");
    const mobileShot = join(dir, "mobile.png");
    writeFileSync(shot, TINY_PNG);
    writeFileSync(mobileShot, TINY_PNG);
    const page0 = audit.pages[0] ?? { url: audit.url ?? "https://x", title: null, loadMs: null, issues: [] };
    ctx.store.audits.save({
      ...audit,
      pages: [{ ...page0, screenshotPath: shot, mobileScreenshotPath: mobileShot }, ...audit.pages.slice(1)],
    });

    let receivedImages = 0;
    ctx.integrations.llm.scoreVisualDesign = async (_ticket, input) => {
      receivedImages = input.images.length;
      // A confident "weak" verdict — the visual layer's job is to surface a
      // strong opportunity the deterministic audit missed.
      return { visualOpportunityScore: 88, verdict: "weak", confidence: 0.9, findings: [], positives: [], model: "stub" };
    };

    // Re-run lead.score EXPLICITLY now that screenshots + the stub are in place.
    await runScore(l.id, audit.id);

    // Both screenshots were read + base64-encoded and handed to the vision model.
    expect(receivedImages).toBe(2);
    const saved = ctx.store.audits.get(audit.id)!;
    expect(saved.visualAssessment?.verdict).toBe("weak");
    expect(ctx.store.activity.list({ leadId: l.id }).some((a) => a.kind === "visual_scored")).toBe(true);

    // A NEW score was appended by the explicit (visual) run...
    const afterScores = ctx.store.leadScores.list({ leadId: l.id });
    expect(afterScores.length).toBe(preVisualScores.length + 1);
    // ...and THAT score — the one the explicit visual run produced, identified by
    // its id (not by list order, which can tie when both rows share a timestamp)
    // — is warm/hot. With visual scoring as a no-op this score would still read
    // "cold" and FAIL, so the tier change is attributable to the visual verdict.
    const visualScore = afterScores.find((s) => s.id !== preVisual.id)!;
    expect(visualScore).toBeDefined();
    expect(visualScore.tier === "warm" || visualScore.tier === "hot").toBe(true);
  });

  it("scores deterministically when there are no screenshots — the adapter is never called", async () => {
    const { lead: l, audit } = await leadAndAudit("Mock Mode Barbers");
    // Mock/http audit → screenshot paths are null already; assert and proceed.
    expect(audit.pages[0]?.screenshotPath ?? null).toBeNull();

    let called = false;
    ctx.integrations.llm.scoreVisualDesign = async () => {
      called = true;
      return null;
    };

    await runScore(l.id, audit.id);

    expect(called).toBe(false);
    expect(ctx.store.audits.get(audit.id)!.visualAssessment).toBeNull();
    expect(ctx.store.activity.list({ leadId: l.id }).some((a) => a.kind === "visual_scored")).toBe(false);
    // A score was still produced (deterministic only).
    expect(ctx.store.leadScores.list({ leadId: l.id }).length).toBeGreaterThan(0);
  });

  it("degrades to deterministic-only when a screenshot read fails — never throws, never calls the adapter", async () => {
    const { lead: l, audit } = await leadAndAudit("Broken Shot Barbers");

    // Point the audit's first page at a screenshot path that does NOT exist on
    // disk. handleScore's readFileSync will throw INSIDE the try block, before
    // the vision adapter is ever reached.
    const missing = join(tmpdir(), `william-missing-${newId("png")}.png`);
    expect(existsSync(missing)).toBe(false); // genuinely absent
    const page0 = audit.pages[0] ?? { url: audit.url ?? "https://x", title: null, loadMs: null, issues: [] };
    ctx.store.audits.save({
      ...audit,
      pages: [{ ...page0, screenshotPath: missing, mobileScreenshotPath: null }, ...audit.pages.slice(1)],
    });

    let called = false;
    ctx.integrations.llm.scoreVisualDesign = async () => {
      called = true; // must never be reached — readFileSync throws first
      return { visualOpportunityScore: 88, verdict: "weak", confidence: 0.9, findings: [], positives: [], model: "stub" };
    };

    const scoresBefore = ctx.store.leadScores.list({ leadId: l.id }).length;

    // The handler resolves WITHOUT throwing (the catch falls back to deterministic).
    await expect(runScore(l.id, audit.id)).resolves.not.toThrow();

    // The adapter was never reached (the read threw before the call).
    expect(called).toBe(false);
    // No visual assessment was persisted (the catch ran instead of the save).
    expect(ctx.store.audits.get(audit.id)!.visualAssessment).toBeNull();
    expect(ctx.store.activity.list({ leadId: l.id }).some((a) => a.kind === "visual_scored")).toBe(false);
    // A LeadScore was still produced by the deterministic path.
    expect(ctx.store.leadScores.list({ leadId: l.id }).length).toBe(scoresBefore + 1);
  });

  // --- Operational-ticket credential wiring (staging dry-run gate) ----------
  // Regression (found in the first real staging run): handleScore minted the
  // visual-scoring ticket with NO credential, so `computeDryRun` forced dry-run
  // even on staging (cred "missing" ⇒ simulate) and the real Anthropic adapter
  // always returned null. The ticket must now carry the anthropic credential so
  // the vision call runs live when env+creds permit — while a MISSING credential
  // STILL forces dry-run (invariant 3: no creds ⇒ simulate, never live).
  function pointAtScreenshot(audit: ReturnType<typeof ctx.store.audits.get> & object) {
    const dir = mkdtempSync(join(tmpdir(), "william-cred-"));
    tempDirs.push(dir);
    const shot = join(dir, "desktop.png");
    writeFileSync(shot, TINY_PNG);
    const page0 = audit.pages[0] ?? { url: audit.url ?? "https://x", title: null, loadMs: null, issues: [] };
    ctx.store.audits.save({
      ...audit,
      pages: [{ ...page0, screenshotPath: shot, mobileScreenshotPath: null }, ...audit.pages.slice(1)],
    });
  }

  function setCredential(integration: string, mode: "missing" | "sandbox" | "live") {
    const existing = ctx.store.credentialStatuses.findByKey(`integration:${integration}`)[0];
    if (existing) {
      ctx.store.credentialStatuses.save({ ...existing, mode });
      return;
    }
    const now = nowIso();
    ctx.store.credentialStatuses.insert({
      id: newId("cred"),
      createdAt: now,
      updatedAt: now,
      integration: integration as "anthropic",
      mode,
      healthy: mode !== "missing",
      lastCheckedAt: now,
      detail: "test",
    });
  }

  it("wires the anthropic credential into the visual-scoring ticket → runs live on staging", async () => {
    const { lead: l, audit } = await leadAndAudit("Cred Wired Barbers");
    pointAtScreenshot(audit);
    ctx.config.env = "staging";
    ctx.config.dryRun = false;
    setCredential("anthropic", "sandbox");

    let seenDryRun: boolean | null = null;
    ctx.integrations.llm.scoreVisualDesign = async (ticket) => {
      seenDryRun = ticket.dryRun;
      return { visualOpportunityScore: 80, verdict: "weak", confidence: 0.9, findings: [], positives: [], model: "stub" };
    };
    await runScore(l.id, audit.id);

    // Credential present + staging ⇒ the ticket is LIVE (the real adapter would
    // hit the network). Before the fix this was `true` and the call no-op'd.
    expect(seenDryRun).toBe(false);
    expect(ctx.store.audits.get(audit.id)!.visualAssessment?.verdict).toBe("weak");
  });

  it("keeps the visual-scoring ticket dry-run when the anthropic credential is missing (invariant 3)", async () => {
    const { lead: l, audit } = await leadAndAudit("No Cred Barbers");
    pointAtScreenshot(audit);
    ctx.config.env = "staging";
    ctx.config.dryRun = false;
    setCredential("anthropic", "missing");

    let seenDryRun: boolean | null = null;
    ctx.integrations.llm.scoreVisualDesign = async (ticket) => {
      seenDryRun = ticket.dryRun;
      return null; // mirror the real adapter's dry-run early return
    };
    await runScore(l.id, audit.id);

    // No credential ⇒ forced dry-run, even on staging with DRY_RUN=false.
    expect(seenDryRun).toBe(true);
  });
});

// We never GUESS an email (no info@<domain> fabrication). A lead whose email
// can't be found on its own site (homepage pass + crawl) is not contactable and
// is disqualified — UNLESS a real enrichment provider is configured, in which
// case its found result is used (still validated by domain + verification).
describe("email gate: no real email → disqualified (no info@ guessing)", () => {
  function noEmailAudit(leadId: string, url: string) {
    const now = nowIso();
    return ctx.store.audits.insert({
      id: newId("aud"), createdAt: now, updatedAt: now, leadId,
      url, mode: "mock", robotsAllowed: true,
      hasWebsite: true, hasSsl: true, mobileFriendly: true, pages: [],
      lighthouse: { performance: 70, accessibility: 70, bestPractices: 70, seo: 70 },
      a11yFindings: [],
      extracted: { contactEmails: [], phones: [], socialLinks: {}, ctas: [], services: [], trustSignals: [] },
      weaknesses: [], outreachAngles: [], summary: "no published email", auditScore: 50,
      completedAt: now, visualAssessment: null,
    });
  }

  async function runContact(leadId: string, auditId: string) {
    const { JOB_HANDLERS } = await import("../src/pipelines");
    const now = nowIso();
    const job = {
      id: newId("job"), type: "lead.contact", payload: { leadId, auditId },
      status: "running" as const, traceId: newTraceId(), leadId,
      runAt: now, attempts: 0, maxAttempts: 3, lastError: null, createdAt: now, updatedAt: now,
    };
    return JOB_HANDLERS["lead.contact"]!(ctx, job);
  }

  function configureEnrichment(mode: "sandbox" | "live") {
    const existing = ctx.store.credentialStatuses.findByKey("integration:enrichment")[0];
    const now = nowIso();
    if (existing) {
      ctx.store.credentialStatuses.save({ ...existing, mode });
      return;
    }
    ctx.store.credentialStatuses.insert({
      id: newId("cred"), createdAt: now, updatedAt: now,
      integration: "enrichment" as "anthropic", mode, healthy: true, lastCheckedAt: now, detail: "test",
    });
  }

  it("disqualifies a no-email lead with no enrichment provider — never guesses info@<domain>", async () => {
    ingestLead(ctx, lead("No Email Biz", "https://danbi-like.com"));
    const l = ctx.store.leads.list()[0]!;
    const audit = noEmailAudit(l.id, "https://danbi-like.com");
    ctx.browserLauncher = async () => null; // crawl finds nothing
    await runContact(l.id, audit.id);
    // No info@danbi-like.com fabricated; lead kept but disqualified.
    expect(ctx.store.contacts.list({ leadId: l.id }).length).toBe(0);
    const lead_ = ctx.store.leads.get(l.id)!;
    expect(lead_.status).toBe("disqualified");
    expect(lead_.disqualifiedReason).toMatch(/no contactable email/i);
    expect(ctx.store.leads.get(l.id)).toBeDefined(); // record KEPT
  });

  it("uses a configured enrichment provider's real contact (validated by domain)", async () => {
    ingestLead(ctx, lead("Enriched Biz", "https://danbi-like.com"));
    const l = ctx.store.leads.list()[0]!;
    const audit = noEmailAudit(l.id, "https://danbi-like.com");
    ctx.browserLauncher = async () => null;
    configureEnrichment("sandbox");
    ctx.integrations.enrichment.findContacts = async () => [
      { email: "owner@danbi-like.com", name: "Dan", role: "owner", confidence: 0.8, provider: "stub" },
    ];
    await runContact(l.id, audit.id);
    const contacts = ctx.store.contacts.list({ leadId: l.id });
    expect(contacts.length).toBe(1);
    expect(contacts[0]!.email).toBe("owner@danbi-like.com");
    expect(contacts[0]!.emailSource).toBe("enrichment");
    expect(ctx.store.leads.get(l.id)!.status).not.toBe("disqualified");
  });

  it("rejects a configured provider's placeholder-domain address → disqualified", async () => {
    ingestLead(ctx, lead("Placeholder Biz", "https://example.com"));
    const l = ctx.store.leads.list()[0]!;
    const audit = noEmailAudit(l.id, "https://example.com");
    ctx.browserLauncher = async () => null;
    configureEnrichment("sandbox");
    ctx.integrations.enrichment.findContacts = async () => [
      { email: "info@example.com", name: null, role: null, confidence: 0.5, provider: "stub" },
    ];
    await runContact(l.id, audit.id);
    expect(ctx.store.contacts.list({ leadId: l.id }).length).toBe(0);
    expect(ctx.store.leads.get(l.id)!.status).toBe("disqualified");
  });
});

// Domain seed values (sum of char codes % 3) used here:
//   b-coffee.example.com → seed 1918 → 1918%3=1 → bad=1 → score ~31 (cold, ≤ 45)
//   a-coffee.example.com → seed 1917 → 1917%3=0 → bad=0 → score ~96 (hot, > 45)
describe("score threshold gate (task 14)", () => {
  it("does not enqueue outreach.draft when score <= threshold — lead kept as scored, not emailed", async () => {
    ctx.config.outreachScoreThreshold = 45;
    // bad=1 domain → score ~31, cold tier — well below the 45 threshold.
    ingestLead(ctx, lead("B Coffee", "https://b-coffee.example.com", "owner@b-coffee.example.com"));
    await runUntilEmpty(ctx, 100, futureClock);

    const l = ctx.store.leads.list()[0]!;
    // Lead is KEPT (record exists) and NOT emailed (no draft), NOT disqualified.
    expect(l.status).toBe("scored");
    expect(ctx.store.outreachDrafts.list({ leadId: l.id })).toHaveLength(0);
    // No outreach.draft job should be in the queue for this lead.
    expect(ctx.store.queue.list().some((j) => j.type === "outreach.draft" && j.leadId === l.id)).toBe(false);
    // A below_threshold activity must have been written.
    expect(ctx.store.activity.list({ leadId: l.id }).some((a) => a.kind === "below_threshold")).toBe(true);
  });

  it("enqueues outreach.draft when score > threshold", async () => {
    ctx.config.outreachScoreThreshold = 45;
    // bad=0 domain → score ~96, hot tier — well above the 45 threshold.
    ingestLead(ctx, lead("A Coffee", "https://a-coffee.example.com", "owner@a-coffee.example.com"));
    await runUntilEmpty(ctx, 100, futureClock);

    const l = ctx.store.leads.list()[0]!;
    // Lead reached draft_ready — a draft was created and is awaiting owner approval.
    expect(l.status).toBe("draft_ready");
    expect(ctx.store.outreachDrafts.list({ leadId: l.id }).length).toBeGreaterThan(0);
    // No below_threshold activity — the lead did qualify.
    expect(ctx.store.activity.list({ leadId: l.id }).some((a) => a.kind === "below_threshold")).toBe(false);
  });
});

// a-coffee.example.com → seed 1917 → 1917%3=0 → bad=0 → score ~96 (hot, > 45)
describe("push mode (task 15)", () => {
  it("review mode: draft awaits approval, no send enqueued", async () => {
    ctx.config.pushMode = "review";
    ctx.config.outreachScoreThreshold = 45;
    ingestLead(ctx, lead("A Coffee Review", "https://a-coffee.example.com", "owner@a-coffee.example.com"));
    await runUntilEmpty(ctx, 100, futureClock);

    const l = ctx.store.leads.list()[0]!;
    if (l.status !== "draft_ready") return; // scored below threshold or disqualified — not applicable

    // Draft must be pending owner approval — not auto-granted.
    const draft = ctx.store.outreachDrafts.list({ leadId: l.id })[0]!;
    expect(draft.status).toBe("pending_approval");
    // Approval must still be pending (not granted).
    const approval = ctx.store.approvals.list({ status: "pending" }).find((a) => a.subjectId === draft.id);
    expect(approval).toBeDefined();
    // No outreach.send job should have been enqueued for this lead.
    const sendJob = ctx.store.queue.list().find((j) => j.type === "outreach.send" && j.leadId === l.id);
    expect(sendJob).toBeUndefined();
  });

  it("auto mode: draft is auto-granted and outreach.send is enqueued", async () => {
    ctx.config.pushMode = "auto";
    ctx.config.outreachScoreThreshold = 45;
    ingestLead(ctx, lead("A Coffee Auto", "https://a-coffee.example.com", "owner@a-coffee.example.com"));
    await runUntilEmpty(ctx, 100, futureClock);

    const l = ctx.store.leads.list()[0]!;
    if (l.status === "disqualified" || l.status === "scored") return; // guard: threshold/contact edge case

    // No pending approvals — the approval was auto-granted by handleDraft.
    const pending = ctx.store.approvals.list({ status: "pending" });
    expect(pending).toHaveLength(0);
    // A granted approval must exist for the draft.
    const granted = ctx.store.approvals.list().find((a) => a.status === "granted");
    expect(granted).toBeDefined();
    // The grant must be attributed to the system (auto-push), not the owner.
    expect(granted!.decidedBy).toBe("system:auto_push");
    // An outreach.send job must have been enqueued (and subsequently run).
    const sendJob = ctx.store.queue.list().find((j) => j.type === "outreach.send" && j.leadId === l.id);
    expect(sendJob).toBeDefined();
    // The send ran successfully → lead is contacted (dry-run in local).
    expect(ctx.store.leads.get(l.id)!.status).toBe("contacted");
  });
});
