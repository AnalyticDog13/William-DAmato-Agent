import { newId, nowIso, type DailyMemory } from "@william/core";
import type { AppContext } from "./context";

export interface MetricsSnapshot {
  leadsTotal: number;
  leadsContacted: number;
  approvalsPending: number;
  deadJobs: number;
}

export function computeMetrics(ctx: AppContext): MetricsSnapshot {
  const s = ctx.store;
  return {
    leadsTotal: s.leads.count(),
    leadsContacted: s.campaignSyncs.count(),
    approvalsPending: s.approvals.count({ status: "pending" }),
    deadJobs: s.queue.list({ status: "dead" }).length,
  };
}

/** Writes the DailyMemory record and returns an owner-readable report. */
export function generateDailyReport(ctx: AppContext, date = new Date().toISOString().slice(0, 10)): { memory: DailyMemory; reportText: string } {
  const m = computeMetrics(ctx);
  const failures = ctx.store.failures.list({ limit: 20 });
  const recommendations = ctx.memory.generateRecommendations();
  const openRequests = ctx.store.ownerRequests.list({ status: "open", limit: 50 });
  const wins: string[] = [];
  if (m.leadsTotal > 0) wins.push(`${m.leadsTotal} leads in pipeline`);

  const bottlenecks: string[] = [];
  if (m.approvalsPending > 0) bottlenecks.push(`${m.approvalsPending} approval(s) waiting in Review Queue`);
  for (const r of openRequests.slice(0, 5)) bottlenecks.push(`OwnerRequest open: ${r.title}`);

  const memory = ctx.memory.writeDailyMemory(date, {
    summary: `Pipeline: ${m.leadsTotal} leads, ${m.leadsContacted} contacted.`,
    wins,
    failures: failures.slice(0, 10).map((f) => `[${f.category}] ${f.message}`),
    bottlenecks,
    improvements: recommendations,
    metrics: {
      leadsTotal: m.leadsTotal,
      contacted: m.leadsContacted,
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
    `- Leads: ${m.leadsTotal} | Contacted: ${m.leadsContacted} | Pending approvals: ${m.approvalsPending}`,
    ``,
    wins.length ? `## Wins\n${wins.map((w) => `- ${w}`).join("\n")}` : "",
    bottlenecks.length ? `## Needs you\n${bottlenecks.map((b) => `- ${b}`).join("\n")}` : "",
    recommendations.length ? `## Suggested improvements\n${recommendations.map((r) => `- ${r}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { memory, reportText };
}
