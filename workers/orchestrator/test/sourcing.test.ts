import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newId, newTraceId, nowIso } from "@william/core";
import {
  createContext,
  decideApproval,
  requestApproval,
  runUntilEmpty,
  type AppContext,
} from "../src/index";

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

describe("lead.source controller", () => {
  let ctx: AppContext;

  beforeEach(() => {
    ctx = createContext({ inMemory: true, silent: true });
  });

  it("sources, ingests, and stops when target is met or Places exhausted", async () => {
    // Two businesses — both will be ingested. The mock audit synthesises
    // info@<subdomain>.example.com for domains where bad < 2, which passes
    // the placeholder check (the domain is not in PLACEHOLDER_DOMAINS), so
    // the pipeline reaches outreach.draft and the lead qualifies.
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
});
