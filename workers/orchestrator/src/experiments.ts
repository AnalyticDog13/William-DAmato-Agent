import { newId, nowIso, type Experiment, type ExperimentResult } from "@william/core";
import type { AppContext } from "./context";

/**
 * Experiment engine. Variants are assigned deterministically per lead — the
 * draft's `variant` field IS the assignment record (no extra table, and a
 * re-enqueued draft job can never flip arms). Results are computed by joining
 * sent drafts to reply events per variant and upserted so recomputation
 * (weekly report, dashboard refresh) never duplicates rows.
 */

/** First running experiment for a dimension; null when none. */
export function runningExperiment(ctx: AppContext, dimension: Experiment["dimension"]): Experiment | null {
  return (
    ctx.store.experiments
      .list({ status: "running", limit: 50 })
      .find((e) => e.dimension === dimension) ?? null
  );
}

/** Deterministic FNV-1a hash assignment: stable per (experiment, lead). */
export function assignVariant(experiment: Experiment, leadId: string): string {
  const input = `${experiment.id}:${leadId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return experiment.variants[hash % experiment.variants.length]!;
}

const SENT_STATUSES = new Set(["sent", "sent_dry_run"]);

/**
 * Computes per-variant outreach metrics (sends, replies, positive_replies,
 * reply_rate) for an outreach_variant experiment. Auto-replies don't count
 * as a response (owner rule). One ExperimentResult per variant+metric,
 * updated in place on recompute.
 */
export function computeExperimentResults(ctx: AppContext, experiment: Experiment): ExperimentResult[] {
  if (experiment.dimension !== "outreach_variant") return [];
  const drafts = ctx.store.outreachDrafts.list({ limit: 1000 });
  const replies = ctx.store.replyEvents.list({ limit: 1000 }).filter((r) => r.intent !== "auto_reply");
  const existing = ctx.store.experimentResults.list({ skey: experiment.id, limit: 500 });
  const now = nowIso();
  const rate = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

  const results: ExperimentResult[] = [];
  for (const variant of experiment.variants) {
    const sentLeadIds = new Set(
      drafts.filter((d) => d.variant === variant && SENT_STATUSES.has(d.status) && d.sentAt).map((d) => d.leadId),
    );
    const variantReplies = replies.filter((r) => sentLeadIds.has(r.leadId));
    const positive = variantReplies.filter((r) => r.intent === "positive");
    const metrics: Record<string, number> = {
      sends: sentLeadIds.size,
      replies: variantReplies.length,
      positive_replies: positive.length,
      reply_rate: rate(variantReplies.length, sentLeadIds.size),
    };
    for (const [metric, value] of Object.entries(metrics)) {
      const prior = existing.find((r) => r.variant === variant && r.metric === metric);
      const record: ExperimentResult = {
        id: prior?.id ?? newId("expr"),
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
        experimentId: experiment.id,
        variant,
        metric,
        value,
        sampleSize: sentLeadIds.size,
        periodStart: experiment.createdAt,
        periodEnd: now,
      };
      results.push(prior ? ctx.store.experimentResults.save(record) : ctx.store.experimentResults.insert(record));
    }
  }
  return results;
}

/** Human-readable per-variant summaries of every running experiment, for reports. */
export function experimentFindings(ctx: AppContext): string[] {
  const findings: string[] = [];
  for (const experiment of ctx.store.experiments.list({ status: "running", limit: 50 })) {
    const results = computeExperimentResults(ctx, experiment);
    if (results.length === 0) continue;
    const byVariant = experiment.variants
      .map((variant) => {
        const get = (metric: string) => results.find((r) => r.variant === variant && r.metric === metric)?.value ?? 0;
        return `${variant}: ${get("sends")} sends, ${get("replies")} replies (${get("positive_replies")} positive, ${get("reply_rate")}% reply rate)`;
      })
      .join("; ");
    findings.push(`${experiment.name} — ${byVariant}`);
  }
  return findings;
}
