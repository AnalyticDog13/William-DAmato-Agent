import { beforeEach, describe, expect, it } from "vitest";
import { newId, nowIso, type Experiment } from "@william/core";
import { FIRST_TOUCH_VARIANTS } from "@william/worker-outreach";
import {
  assignVariant,
  computeExperimentResults,
  experimentFindings,
  runningExperiment,
  createContext,
  ingestLead,
  runUntilEmpty,
  type AppContext,
} from "../src/index";

const futureClock = () => new Date(Date.now() + 10 * 60_000);

let ctx: AppContext;
beforeEach(() => {
  ctx = createContext({ inMemory: true, silent: true });
});

function insertExperiment(overrides: Partial<Experiment> = {}): Experiment {
  const now = nowIso();
  return ctx.store.experiments.insert({
    id: newId("exp"),
    createdAt: now,
    updatedAt: now,
    name: "first-touch copy A/B",
    hypothesis: "finding-first copy gets more replies",
    dimension: "outreach_variant",
    variants: [...FIRST_TOUCH_VARIANTS],
    status: "running",
    conclusion: "",
    ...overrides,
  });
}

function insertSentDraft(leadId: string, variant: string) {
  const now = nowIso();
  ctx.store.outreachDrafts.insert({
    id: newId("odft"),
    createdAt: now,
    updatedAt: now,
    leadId,
    contactId: newId("con"),
    variant,
    subject: "s",
    body: "b",
    personalizationNotes: [],
    auditFindingsUsed: [],
    status: "sent_dry_run",
    approvalRequestId: null,
    sentAt: now,
    traceId: "trc",
  });
}

function insertReply(leadId: string, intent: "positive" | "negative" | "neutral") {
  const now = nowIso();
  ctx.store.replyEvents.insert({
    id: newId("rply"),
    createdAt: now,
    updatedAt: now,
    leadId,
    contactId: null,
    provider: "manual",
    externalMessageId: null,
    receivedAt: now,
    intent,
    intentConfidence: 0.9,
    bodyExcerpt: "",
    threadSummary: "",
    recommendedNextStep: "",
    ownerNotifiedAt: null,
    followUpsPaused: false,
  });
}

describe("variant assignment", () => {
  it("is deterministic per lead and spreads across variants", () => {
    const experiment = insertExperiment();
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const leadId = `lead_${i}`;
      const first = assignVariant(experiment, leadId);
      expect(assignVariant(experiment, leadId)).toBe(first); // stable
      expect(experiment.variants).toContain(first);
      seen.add(first);
    }
    expect(seen.size).toBe(experiment.variants.length); // both arms used
  });

  it("runningExperiment finds only running experiments of the dimension", () => {
    insertExperiment({ status: "concluded" });
    expect(runningExperiment(ctx, "outreach_variant")).toBeNull();
    const running = insertExperiment();
    expect(runningExperiment(ctx, "outreach_variant")?.id).toBe(running.id);
    expect(runningExperiment(ctx, "niche")).toBeNull();
  });
});

describe("computeExperimentResults (outreach_variant)", () => {
  it("computes sends/replies/positive_replies/reply_rate per variant and upserts", () => {
    const experiment = insertExperiment();
    // v1: 3 sends, 2 replies (1 positive). v2: 2 sends, 1 reply (0 positive).
    for (const [i, variant] of (["v1-cornell-mockup", "v1-cornell-mockup", "v1-cornell-mockup", "v2-finding-first", "v2-finding-first"] as const).entries()) {
      insertSentDraft(`lead_${i}`, variant);
    }
    insertReply("lead_0", "positive");
    insertReply("lead_1", "neutral");
    insertReply("lead_3", "negative");

    const results = computeExperimentResults(ctx, experiment);
    const get = (variant: string, metric: string) => results.find((r) => r.variant === variant && r.metric === metric);
    expect(get("v1-cornell-mockup", "sends")?.value).toBe(3);
    expect(get("v1-cornell-mockup", "replies")?.value).toBe(2);
    expect(get("v1-cornell-mockup", "positive_replies")?.value).toBe(1);
    expect(get("v1-cornell-mockup", "reply_rate")?.value).toBeCloseTo(66.7, 1);
    expect(get("v2-finding-first", "sends")?.value).toBe(2);
    expect(get("v2-finding-first", "replies")?.value).toBe(1);
    expect(get("v2-finding-first", "reply_rate")?.value).toBeCloseTo(50, 1);
    expect(get("v1-cornell-mockup", "sends")?.sampleSize).toBe(3);

    // Recompute must update in place, not duplicate.
    computeExperimentResults(ctx, experiment);
    expect(ctx.store.experimentResults.list({ skey: experiment.id })).toHaveLength(results.length);
  });

  it("experimentFindings renders human-readable lines for running experiments", () => {
    insertExperiment();
    insertSentDraft("lead_0", "v1-cornell-mockup");
    const findings = experimentFindings(ctx);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.join()).toContain("first-touch copy A/B");
    expect(findings.join()).toContain("v1-cornell-mockup");
  });
});
