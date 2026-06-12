import type { DailyMemory } from "@william/core";
import type { AppContext } from "./context";

export interface MetricsSnapshot {
  leadsTotal: number;
  leadsContacted: number;
  replies: number;
  positiveReplies: number;
  bounces: number;
  unsubscribes: number;
  opportunities: number;
  previewsBuilt: number;
  approvalsPending: number;
  deadJobs: number;
  replyRate: number;
  positiveReplyRate: number;
  bounceRate: number;
  unsubscribeRate: number;
}

export function computeMetrics(ctx: AppContext): MetricsSnapshot {
  const s = ctx.store;
  const leadsTotal = s.leads.count();
  // Denominator for rates = actual sends (campaign syncs), not lead status,
  // because statuses move past "contacted" as replies arrive.
  const contacted = s.campaignSyncs.count();
  const replies = s.replyEvents.count();
  const positive = s.replyEvents.count({ status: "positive" });
  const bounces = s.replyEvents.count({ status: "bounce" });
  const unsubscribes = s.replyEvents.count({ status: "unsubscribe" });
  const rate = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
  return {
    leadsTotal,
    leadsContacted: contacted,
    replies,
    positiveReplies: positive,
    bounces,
    unsubscribes,
    opportunities: s.opportunities.count(),
    previewsBuilt: s.siteProjects.count(),
    approvalsPending: s.approvals.count({ status: "pending" }),
    deadJobs: s.queue.list({ status: "dead" }).length,
    replyRate: rate(replies, contacted),
    positiveReplyRate: rate(positive, contacted),
    bounceRate: rate(bounces, contacted),
    unsubscribeRate: rate(unsubscribes, contacted),
  };
}

/** Writes the DailyMemory record and returns an owner-readable report. */
export function generateDailyReport(ctx: AppContext, date = new Date().toISOString().slice(0, 10)): { memory: DailyMemory; reportText: string } {
  const m = computeMetrics(ctx);
  const failures = ctx.store.failures.list({ limit: 20 });
  const recommendations = ctx.memory.generateRecommendations();
  const openRequests = ctx.store.ownerRequests.list({ status: "open", limit: 50 });
  const wins: string[] = [];
  if (m.positiveReplies > 0) wins.push(`${m.positiveReplies} positive repl${m.positiveReplies === 1 ? "y" : "ies"}`);
  if (m.previewsBuilt > 0) wins.push(`${m.previewsBuilt} preview site(s) generated`);
  if (m.leadsTotal > 0) wins.push(`${m.leadsTotal} leads in pipeline`);

  const bottlenecks: string[] = [];
  if (m.approvalsPending > 0) bottlenecks.push(`${m.approvalsPending} approval(s) waiting in Review Queue`);
  for (const r of openRequests.slice(0, 5)) bottlenecks.push(`OwnerRequest open: ${r.title}`);

  const memory = ctx.memory.writeDailyMemory(date, {
    summary: `Pipeline: ${m.leadsTotal} leads, ${m.leadsContacted} contacted, ${m.replies} replies (${m.positiveReplies} positive), ${m.opportunities} opportunities, ${m.previewsBuilt} previews.`,
    wins,
    failures: failures.slice(0, 10).map((f) => `[${f.category}] ${f.message}`),
    bottlenecks,
    improvements: recommendations,
    metrics: {
      leadsTotal: m.leadsTotal,
      contacted: m.leadsContacted,
      replyRate: m.replyRate,
      positiveReplyRate: m.positiveReplyRate,
      bounceRate: m.bounceRate,
      unsubscribeRate: m.unsubscribeRate,
      opportunities: m.opportunities,
      previews: m.previewsBuilt,
      deadJobs: m.deadJobs,
    },
    whatChangedAndWhy: ctx.store.auditLog
      .list({ limit: 15 })
      .map((a) => `${a.action} → ${a.outcome}${a.detail ? ` (${a.detail.slice(0, 80)})` : ""}`),
  });

  const reportText = [
    `# William D'Amato — Daily Report ${date}`,
    ``,
    memory.summary,
    ``,
    `## Metrics`,
    `- Reply rate: ${m.replyRate}% | Positive: ${m.positiveReplyRate}% | Bounce: ${m.bounceRate}% | Unsub: ${m.unsubscribeRate}%`,
    `- Opportunities: ${m.opportunities} | Previews built: ${m.previewsBuilt} | Pending approvals: ${m.approvalsPending}`,
    ``,
    wins.length ? `## Wins\n${wins.map((w) => `- ${w}`).join("\n")}` : "",
    bottlenecks.length ? `## Needs you\n${bottlenecks.map((b) => `- ${b}`).join("\n")}` : "",
    recommendations.length ? `## Suggested improvements\n${recommendations.map((r) => `- ${r}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { memory, reportText };
}
