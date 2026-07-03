import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newId, newTraceId, nowIso, type Niche } from "@william/core";
import {
  createContext,
  decideApproval,
  requestApproval,
  runUntilEmpty,
  type AppContext,
} from "../src/index";

// ─── Pre-seed helper ──────────────────────────────────────────────────────────

/**
 * Directly seed a Lead that already qualifies for `countQualified`:
 *   - has an OutreachDraft (any status)
 *   - has a LeadScore > 35
 * Returns the leadId so the caller can pass it to approvedRun's leadIds.
 * Uses direct store inserts to avoid queue-pollution from ingestLead.
 */
function seedQualifiedLead(ctx: AppContext): string {
  const now = nowIso();
  const companyId = newId("com");
  const leadId = newId("lead");
  const contactId = newId("con");

  ctx.store.companies.insert({
    id: companyId,
    createdAt: now,
    updatedAt: now,
    name: "Qualified Test Biz",
    identityKey: "company:qualified-test-biz:ithaca",
    niche: "coffee_shop",
    city: "Ithaca",
    region: "NY",
    country: "US",
    phone: null,
    address: null,
    socialLinks: {},
    description: "",
  });

  ctx.store.leads.insert({
    id: leadId,
    createdAt: now,
    updatedAt: now,
    companyId,
    domain: "qualified-test.example.com",
    websiteUrl: "https://qualified-test.example.com",
    niche: "coffee_shop",
    status: "draft_ready",
    source: { kind: "google_maps", detail: "test", importedAt: now, importedBy: "system" },
    identityKeys: [
      "domain:qualified-test.example.com",
      "company:qualified-test-biz:ithaca",
    ],
    notes: "",
    disqualifiedReason: null,
  });

  ctx.store.contacts.insert({
    id: contactId,
    createdAt: now,
    updatedAt: now,
    leadId,
    companyId,
    name: null,
    role: null,
    email: "hello@qualified-test.example.com",
    emailSource: "website_published",
    emailProvider: null,
    verification: "valid",
    confidence: 0.9,
    phone: null,
  });

  ctx.store.outreachDrafts.insert({
    id: newId("odft"),
    createdAt: now,
    updatedAt: now,
    leadId,
    contactId,
    variant: "v1-cornell-mockup",
    subject: "Your website",
    body: "Hi there. Reply to opt out.",
    personalizationNotes: [],
    auditFindingsUsed: [],
    status: "pending_approval",
    approvalRequestId: null,
    sentAt: null,
    traceId: newTraceId(),
  });

  ctx.store.leadScores.insert({
    id: newId("scr"),
    createdAt: now,
    updatedAt: now,
    leadId,
    auditId: null,
    score: 60, // well above the 45 default threshold (outreachScoreThreshold)
    tier: "warm",
    reasons: ["pre-seeded for test"],
    scoredAt: now,
  });

  return leadId;
}

// Fast-forward past retry backoff (mirrors pipeline.test.ts).
const futureClock = () => new Date(Date.now() + 10 * 60_000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Insert a SourcingRun with a granted ACTIVATE_NEW_LEAD_SOURCE approval so
 * `evaluateGate` passes in the controller. Mirrors how pipeline.test.ts grants
 * DEPLOY_PRODUCTION / SEND_FIRST_TOUCH via requestApproval + decideApproval.
 */
function approvedRun(
  ctx: AppContext,
  target: number,
  cap: number,
  niche = "coffee_shop",
  location = "Ithaca, NY",
) {
  const traceId = newTraceId();
  const now = nowIso();
  const run = ctx.store.sourcingRuns.insert({
    id: newId("src"),
    createdAt: now,
    updatedAt: now,
    location,
    niche: niche as "coffee_shop",
    target,
    candidateCap: cap,
    status: "running",
    candidatesIngested: 0,
    qualifiedCount: 0,
    leadIds: [],
    nextPageToken: null,
    checks: 0,
    approvalRequestId: null,
    resultNote: null,
    traceId,
    mode: "normal",
    nicheQueue: [],
    currentNiche: null,
  });

  // Grant the ACTIVATE_NEW_LEAD_SOURCE gate (same pattern as pipeline.test.ts).
  const approval = requestApproval(ctx, {
    gate: "ACTIVATE_NEW_LEAD_SOURCE",
    subjectType: "SourcingRun",
    subjectId: run.id,
    title: "Source leads",
    detail: `${niche} in ${location}`,
    traceId,
  });
  decideApproval(ctx, approval.id, "granted", "test");

  return run;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

/**
 * Configure a sandbox enrichment credential so `credentialFor(ctx,"enrichment")`
 * returns non-null, enabling the enrichment rung in handleContact.
 * Required for sourcing tests that need leads to reach outreach.draft: since the
 * reorder puts contact BEFORE audit, and fetchHomepageEmails is dry-run-safe
 * (returns [] in local), sourcing-ingested leads (no owner-provided email) need
 * enrichment to get a contactable address.
 */
function configureEnrichment(ctx: AppContext, mode: "sandbox" | "live") {
  const existing = ctx.store.credentialStatuses.findByKey("integration:enrichment")[0];
  const now = nowIso();
  if (existing) {
    ctx.store.credentialStatuses.save({ ...existing, mode, updatedAt: now });
    return;
  }
  ctx.store.credentialStatuses.insert({
    id: newId("cred"), createdAt: now, updatedAt: now,
    integration: "enrichment" as "anthropic", mode, healthy: true, lastCheckedAt: now, detail: "test",
  });
}

describe("lead.source controller", () => {
  let ctx: AppContext;

  beforeEach(() => {
    ctx = createContext({ inMemory: true, silent: true });
  });

  it("sources, ingests, and stops when target is met or Places exhausted", async () => {
    // Two businesses — both ingested. The new pipeline order is contact→audit→score→draft.
    // fetchHomepageEmails returns [] in dry-run (local), so we configure enrichment to
    // supply a contactable email. a-coffee has mock bad=0 (score ~96 > 45) → qualifies;
    // b-coffee has bad=1 (score ~31 ≤ 45) → below threshold, stays scored, no draft.
    // target=1, so the run completes once a-coffee qualifies.
    configureEnrichment(ctx, "sandbox");
    ctx.integrations.enrichment.findContacts = async (_t, domain) => [
      { email: `info@${domain}`, name: null, role: null, confidence: 0.8, provider: "stub" },
    ];
    ctx.integrations.places.searchBusinesses = async () => ({
      businesses: [
        {
          name: "A Coffee",
          niche: "coffee_shop",
          websiteUrl: "https://a-coffee.example.com",
          phone: null,
          address: null,
          city: "Ithaca",
          rating: 4,
        },
        {
          name: "B Coffee",
          niche: "coffee_shop",
          websiteUrl: "https://b-coffee.example.com",
          phone: null,
          address: null,
          city: "Ithaca",
          rating: 4,
        },
      ],
      nextPageToken: null,
    });

    const run = approvedRun(ctx, 1, 40);
    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: run.traceId,
    });

    // Grant SEND_FIRST_TOUCH approvals as they appear so the pipeline reaches
    // draft_ready (the controller's qualified gate needs an OutreachDraft).
    // The pipeline itself stops at approval; we auto-approve here for test speed.
    // Use a generous max (500) to let all downstream jobs complete.
    await runUntilEmpty(ctx, 500, futureClock);

    const after = ctx.store.sourcingRuns.get(run.id)!;
    // Stops at target (completed) or exhausted; cap is 40 so it won't cap.
    expect(["completed", "stopped_exhausted"]).toContain(after.status);
    // At least one lead was ingested.
    expect(after.candidatesIngested).toBeGreaterThanOrEqual(1);
  });

  it("stops at the candidate cap and records a partial note", async () => {
    // One business on the first call; nothing on subsequent pages.
    ctx.integrations.places.searchBusinesses = async (_t, input) =>
      input.pageToken
        ? { businesses: [], nextPageToken: null }
        : {
            businesses: [
              {
                name: "C Coffee",
                niche: "coffee_shop",
                websiteUrl: "https://c-coffee.example.com",
                phone: null,
                address: null,
                city: "Ithaca",
                rating: 3,
              },
            ],
            nextPageToken: null,
          };

    // cap=1, target=5 → can never reach target with only 1 candidate
    const run = approvedRun(ctx, 5, 1);
    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: run.traceId,
    });

    await runUntilEmpty(ctx, 500, futureClock);

    const after = ctx.store.sourcingRuns.get(run.id)!;
    // Cap hit or exhausted (1 business fits cap=1, then next page = empty → exhausted)
    expect(["stopped_cap", "stopped_exhausted"]).toContain(after.status);
    // The note always references the target (pattern: "of 5")
    expect(after.resultNote ?? "").toMatch(/of 5/);
  });

  it("stops_exhausted when Places returns an empty first page", async () => {
    ctx.integrations.places.searchBusinesses = async () => ({
      businesses: [],
      nextPageToken: null,
    });

    const run = approvedRun(ctx, 5, 40);
    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: run.traceId,
    });

    await runUntilEmpty(ctx, 100, futureClock);

    const after = ctx.store.sourcingRuns.get(run.id)!;
    expect(after.status).toBe("stopped_exhausted");
    expect(after.resultNote).toMatch(/of 5/);
  });

  it("skips duplicate ingests (same URL/domain) — candidatesIngested counts only created", async () => {
    // Supply the same business URL twice.
    ctx.integrations.places.searchBusinesses = async () => ({
      businesses: [
        {
          name: "Dup A",
          niche: "coffee_shop",
          websiteUrl: "https://dup-coffee.example.com",
          phone: null,
          address: null,
          city: "Ithaca",
          rating: 4,
        },
        {
          name: "Dup A Again",
          niche: "coffee_shop",
          websiteUrl: "https://dup-coffee.example.com", // same URL
          phone: null,
          address: null,
          city: "Ithaca",
          rating: 4,
        },
      ],
      nextPageToken: null,
    });

    const run = approvedRun(ctx, 5, 40);
    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: run.traceId,
    });

    await runUntilEmpty(ctx, 500, futureClock);

    const after = ctx.store.sourcingRuns.get(run.id)!;
    // Only one unique lead should have been ingested (the duplicate is skipped).
    expect(after.candidatesIngested).toBe(1);
  });

  it("sources a second page when page 1 alone does not meet the target (multi-page regression)", async () => {
    // Regression guard for the IN_FLIGHT_STATUSES bug:
    // When `draft_ready`/`approved_for_send` were counted as in-flight the controller
    // would see the page-1 lead as "still flowing", re-enqueue indefinitely, exhaust
    // its check cap, and end as `failed` — never sourcing page 2 and never completing.
    // After the fix those statuses are resolved, the controller correctly sources the
    // next page, and the run reaches `completed` with qualifiedCount >= target.
    // Domain selection: the mock auditor synthesizes behaviour deterministically
    // from seed = sum(charCodes(domain)) % 3:
    //   bad=0  → rough site  → high lead score (~96, well above 45 threshold)
    //   bad=1  → mediocre    → low lead score (~31, BELOW 45 threshold)
    //   bad=2  → decent site → very low opportunity score
    //
    // Both domains must have bad=0 so they qualify for countQualified (score>35).
    //   bb-coffee.example.com → seed=2016 → 2016%3=0 → bad=0 → high score
    //   ee-coffee.example.com → seed=2022 → 2022%3=0 → bad=0 → high score
    //
    // Since fetchHomepageEmails returns [] in dry-run (local), enrichment is
    // configured to supply a contactable email so leads proceed through the
    // new contact→audit→score→draft pipeline order.
    configureEnrichment(ctx, "sandbox");
    ctx.integrations.enrichment.findContacts = async (_t, domain) => [
      { email: `info@${domain}`, name: null, role: null, confidence: 0.8, provider: "stub" },
    ];
    let callCount = 0;
    ctx.integrations.places.searchBusinesses = async (_t, input) => {
      callCount += 1;
      if (!input.pageToken) {
        // First call — page 1: one business, more pages available.
        return {
          businesses: [
            {
              name: "BB Coffee",
              niche: "coffee_shop",
              websiteUrl: "https://bb-coffee.example.com",
              phone: null,
              address: null,
              city: "Ithaca",
              rating: 4,
            },
          ],
          nextPageToken: "P2",
        };
      } else if (input.pageToken === "P2") {
        // Second call — page 2: a different business, no further pages.
        return {
          businesses: [
            {
              name: "EE Coffee",
              niche: "coffee_shop",
              websiteUrl: "https://ee-coffee.example.com",
              phone: null,
              address: null,
              city: "Ithaca",
              rating: 4,
            },
          ],
          nextPageToken: null,
        };
      }
      // Any further call returns empty.
      return { businesses: [], nextPageToken: null };
    };

    // target=2 means we need BOTH pages to complete.
    const run = approvedRun(ctx, 2, 40);
    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: run.traceId,
    });

    await runUntilEmpty(ctx, 500, futureClock);

    const after = ctx.store.sourcingRuns.get(run.id)!;
    // The run must complete (not fail or hang) and must have pulled both pages.
    expect(after.status).toBe("completed");
    expect(after.qualifiedCount).toBeGreaterThanOrEqual(2);
    expect(after.candidatesIngested).toBeGreaterThanOrEqual(2);
    // Confirm we actually fetched page 2 (i.e. sourcing advanced past page 1).
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  // ─── Batch mode ──────────────────────────────────────────────────────────

  /**
   * Create a SourcingRun in batch mode with a granted ACTIVATE_NEW_LEAD_SOURCE
   * approval. The first niche in `nicheQueue` is also used as `run.niche` (the
   * base field); batch mode drives the sweep via nicheQueue / currentNiche.
   */
  function approvedBatchRun(
    ctx: AppContext,
    target: number,
    cap: number,
    nicheQueue: Niche[],
    location = "Ithaca, NY",
  ) {
    const traceId = newTraceId();
    const now = nowIso();
    const run = ctx.store.sourcingRuns.insert({
      id: newId("src"),
      createdAt: now,
      updatedAt: now,
      location,
      niche: (nicheQueue[0] ?? "coffee_shop") as Niche,
      target,
      candidateCap: cap,
      status: "running",
      candidatesIngested: 0,
      qualifiedCount: 0,
      leadIds: [],
      nextPageToken: null,
      checks: 0,
      approvalRequestId: null,
      resultNote: null,
      traceId,
      mode: "batch",
      nicheQueue,
      currentNiche: null,
    });

    const approval = requestApproval(ctx, {
      gate: "ACTIVATE_NEW_LEAD_SOURCE",
      subjectType: "SourcingRun",
      subjectId: run.id,
      title: "Source leads (batch)",
      detail: `batch in ${location}`,
      traceId,
    });
    decideApproval(ctx, approval.id, "granted", "test");

    return run;
  }

  it("batch run: no early stop on qualified target; advances niche when a niche is exhausted", async () => {
    // Niche A = coffee_shop: page 1 returns bb-coffee (bad=0 → qualifies), page 2 = empty (exhaust A).
    // Niche B = hair_salon:  page 1 returns bb-salon  (bad=0 → qualifies), page 2 = empty (exhaust B).
    //
    // target=1 — in normal mode the run would stop ("completed") after bb-coffee qualifies.
    // In batch mode the qualified-target stop is skipped; both niches are swept.
    // Run ends "stopped_exhausted" (not "completed"), proving no early stop on target.
    //
    // Domains chosen for deterministic mock scores:
    //   bb-coffee.example.com → sum(charCodes)=2016 → 2016%3=0 → bad=0 → high score ✓
    //   bb-salon.example.com  → sum(charCodes)=1941 → 1941%3=0 → bad=0 → high score ✓
    configureEnrichment(ctx, "sandbox");
    ctx.integrations.enrichment.findContacts = async (_t, domain) => [
      { email: `info@${domain}`, name: null, role: null, confidence: 0.8, provider: "stub" },
    ];

    ctx.integrations.places.searchBusinesses = async (_t, input) => {
      if (input.query.includes("coffee shops")) {
        return input.pageToken
          ? { businesses: [], nextPageToken: null }
          : {
              businesses: [{
                name: "BB Coffee", niche: "coffee_shop",
                websiteUrl: "https://bb-coffee.example.com",
                phone: null, address: null, city: "Ithaca", rating: 4,
              }],
              nextPageToken: "A-P2",
            };
      }
      if (input.query.includes("hair salons")) {
        return input.pageToken
          ? { businesses: [], nextPageToken: null }
          : {
              businesses: [{
                name: "BB Salon", niche: "hair_salon",
                websiteUrl: "https://bb-salon.example.com",
                phone: null, address: null, city: "Ithaca", rating: 4,
              }],
              nextPageToken: "B-P2",
            };
      }
      return { businesses: [], nextPageToken: null };
    };

    const run = approvedBatchRun(ctx, 1, 10, ["coffee_shop", "hair_salon"] as Niche[]);
    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: run.traceId,
    });

    await runUntilEmpty(ctx, 500, futureClock);

    const after = ctx.store.sourcingRuns.get(run.id)!;
    // Both niches exhausted → stopped_exhausted (NOT "completed", which would mean early stop).
    expect(after.status).toBe("stopped_exhausted");
    // Both niches contributed at least one ingested lead.
    expect(after.candidatesIngested).toBeGreaterThanOrEqual(2);
  });

  it("batch run stops at candidate cap", async () => {
    // Places returns 2 businesses per call; cap=2, target=99.
    // After the first page is ingested, candidatesIngested=2 >= cap=2 → stopped_cap on next tick.
    ctx.integrations.places.searchBusinesses = async () => ({
      businesses: [
        { name: "Cap 1", niche: "coffee_shop", websiteUrl: "https://cap1.example.com", phone: null, address: null, city: "Ithaca", rating: 4 },
        { name: "Cap 2", niche: "coffee_shop", websiteUrl: "https://cap2.example.com", phone: null, address: null, city: "Ithaca", rating: 4 },
      ],
      nextPageToken: null,
    });

    const run = approvedBatchRun(ctx, 99, 2, ["coffee_shop"] as Niche[]);
    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: run.traceId,
    });

    await runUntilEmpty(ctx, 500, futureClock);

    const after = ctx.store.sourcingRuns.get(run.id)!;
    expect(after.status).toBe("stopped_cap");
    expect(after.candidatesIngested).toBe(2);
  });

  it("batch run advances niches with REALISTIC Places pagination (non-empty last page, null token)", async () => {
    // Regression guard for the batch-never-sweeps bug.
    //
    // The other batch tests advance the niche only because their mock emits an
    // explicitly EMPTY page (`businesses: []`) after the last real page. Real
    // Google Places never does that — it returns the last page WITH results and
    // simply omits `nextPageToken`. Re-querying with a null pageToken then
    // restarts at page 1. Under that realistic shape the old controller (which
    // advanced only on `businesses.length === 0`) would re-fetch page 1 of the
    // first niche forever, never reaching the second niche, and end `failed`
    // after MAX_SOURCING_CHECKS — effectively sourcing only ONE niche.
    //
    // Here each niche is a single non-empty page with a null token (the common
    // real case: a city has fewer than 20 of a given business type).
    //   bb-coffee.example.com → charcode-sum 2016 → %3=0 → bad=0 → qualifies
    //   bb-salon.example.com  → charcode-sum 1941 → %3=0 → bad=0 → qualifies
    configureEnrichment(ctx, "sandbox");
    ctx.integrations.enrichment.findContacts = async (_t, domain) => [
      { email: `info@${domain}`, name: null, role: null, confidence: 0.8, provider: "stub" },
    ];

    const queried: string[] = [];
    ctx.integrations.places.searchBusinesses = async (_t, input) => {
      queried.push(input.query);
      if (input.query.includes("coffee shops")) {
        // Single non-empty page, no further pages (null token). A null-token
        // re-query restarts at page 1 — exactly how the real API behaves.
        return {
          businesses: [{
            name: "BB Coffee", niche: "coffee_shop",
            websiteUrl: "https://bb-coffee.example.com",
            phone: null, address: null, city: "Ithaca", rating: 4,
          }],
          nextPageToken: null,
        };
      }
      if (input.query.includes("hair salons")) {
        return {
          businesses: [{
            name: "BB Salon", niche: "hair_salon",
            websiteUrl: "https://bb-salon.example.com",
            phone: null, address: null, city: "Ithaca", rating: 4,
          }],
          nextPageToken: null,
        };
      }
      return { businesses: [], nextPageToken: null };
    };

    const run = approvedBatchRun(ctx, 1, 10, ["coffee_shop", "hair_salon"] as Niche[]);
    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: run.traceId,
    });

    await runUntilEmpty(ctx, 500, futureClock);

    const after = ctx.store.sourcingRuns.get(run.id)!;
    // The sweep must FINISH (not fail on the check cap) and must have advanced
    // past the first niche to the second.
    expect(after.status).toBe("stopped_exhausted");
    expect(queried.some((q) => q.includes("hair salons"))).toBe(true);
    // Both niches contributed a lead (coffee + salon).
    expect(after.candidatesIngested).toBe(2);
  });

  it("no-ops if the run is already completed when the job fires", async () => {
    const run = approvedRun(ctx, 1, 40);
    // Mark it completed before the job runs.
    ctx.store.sourcingRuns.save({
      ...run,
      status: "completed",
      updatedAt: nowIso(),
    });

    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: run.traceId,
    });

    await runUntilEmpty(ctx, 50, futureClock);

    // Status must not have changed from completed.
    expect(ctx.store.sourcingRuns.get(run.id)!.status).toBe("completed");
  });

  it("deterministic completed path: pre-qualified lead → status=completed, qualifiedCount>=1", async () => {
    // Pre-seed a lead that already satisfies countQualified (draft + score > 35).
    // This test exercises the target-met branch WITHOUT relying on pipeline timing.
    // It also guards Fix 1: before the stop() closure was fixed it spread the
    // ORIGINAL run snapshot (qualifiedCount=0), so the terminal record would show
    // qualifiedCount=0 and this assertion would fail.
    const leadId = seedQualifiedLead(ctx);

    const traceId = newTraceId();
    const now = nowIso();

    // Create the SourcingRun already referencing the pre-qualified lead.
    const run = ctx.store.sourcingRuns.insert({
      id: newId("src"),
      createdAt: now,
      updatedAt: now,
      location: "Ithaca, NY",
      niche: "coffee_shop",
      target: 1,
      candidateCap: 40,
      status: "running",
      candidatesIngested: 1, // the pre-seeded lead counts as ingested
      qualifiedCount: 0,     // starts at 0; the controller re-counts on first tick
      leadIds: [leadId],
      nextPageToken: null,
      checks: 0,
      approvalRequestId: null,
      resultNote: null,
      traceId,
      mode: "normal",
      nicheQueue: [],
      currentNiche: null,
    });

    // Grant ACTIVATE_NEW_LEAD_SOURCE (required by evaluateGate inside the controller).
    const approval = requestApproval(ctx, {
      gate: "ACTIVATE_NEW_LEAD_SOURCE",
      subjectType: "SourcingRun",
      subjectId: run.id,
      title: "Source leads (deterministic test)",
      detail: "coffee_shop in Ithaca, NY",
      traceId,
    });
    decideApproval(ctx, approval.id, "granted", "test");

    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId,
    });

    // A single tick is sufficient: countQualified returns 1 >= target 1 → completed.
    await runUntilEmpty(ctx, 10, futureClock);

    const after = ctx.store.sourcingRuns.get(run.id)!;
    // Must be completed (not stopped_exhausted or any other status).
    expect(after.status).toBe("completed");
    // qualifiedCount must reflect the re-counted value written by stop().
    // Before Fix 1 this would be 0 (stale snapshot); after Fix 1 it is 1.
    expect(after.qualifiedCount).toBeGreaterThanOrEqual(1);
  });

  it("does not freeze on a below-threshold lead (scored is resolved, not in-flight)", async () => {
    // Regression guard for the IN_FLIGHT_STATUSES bug on `scored`.
    //
    // A lead whose site scores at/below OUTREACH_SCORE_THRESHOLD terminates
    // PERMANENTLY at status `scored` (kept, not emailed — it never gets a draft).
    // When `scored` was counted as in-flight, the controller saw that lead as
    // "still flowing" forever: it re-enqueued every tick, never sourced the next
    // page, exhausted MAX_SOURCING_CHECKS, and ended `failed`. This is exactly
    // what killed the large batch runs — any batch that ingested a single
    // below-threshold lead froze and failed on the check cap.
    //
    //   b-coffee.example.com → charcode-sum → %3=1 → bad=1 → score ~31 (≤45)
    //   → below threshold → stays `scored`, no draft.
    //
    // After the fix `scored` is resolved, so the controller advances past the
    // stuck lead and finishes cleanly (page 2 is empty → stopped_exhausted)
    // instead of failing on the check cap.
    configureEnrichment(ctx, "sandbox");
    ctx.integrations.enrichment.findContacts = async (_t, domain) => [
      { email: `info@${domain}`, name: null, role: null, confidence: 0.8, provider: "stub" },
    ];
    let callCount = 0;
    ctx.integrations.places.searchBusinesses = async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          businesses: [{
            name: "B Coffee", niche: "coffee_shop",
            websiteUrl: "https://b-coffee.example.com",
            phone: null, address: null, city: "Ithaca", rating: 4,
          }],
          nextPageToken: null,
        };
      }
      // Every later page is empty → normal-mode exhaustion, reachable only if the
      // below-threshold lead is treated as resolved (not perpetually in-flight).
      return { businesses: [], nextPageToken: null };
    };

    // target=5 is never met (the sole lead is below threshold); cap=40 is never
    // hit. The only clean terminal state is stopped_exhausted.
    const run = approvedRun(ctx, 5, 40);
    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: run.traceId,
    });

    await runUntilEmpty(ctx, 500, futureClock);

    const after = ctx.store.sourcingRuns.get(run.id)!;
    // Under the bug this is "failed" (froze on the scored lead, hit the check cap).
    expect(after.status).toBe("stopped_exhausted");
    expect(after.candidatesIngested).toBe(1);
  });
});
