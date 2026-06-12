import { newId, nowIso, type DailyMemory, type WeeklyReport } from "@william/core";
import type { AppContext } from "./context";
import { computeExperimentResults, experimentFindings } from "./experiments";

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

/** Every variant needs at least this many sends before a winner becomes a lesson. */
export const MIN_EXPERIMENT_SENDS_FOR_LESSON = 10;
/** A failure category recurring this often in one week becomes a process lesson. */
const RECURRING_FAILURE_THRESHOLD = 5;

function isoDaysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Weekly rollup: aggregates the week's daily memories, failures, and
 * experiment findings; derives DurableLessons from clear signals. Upserted
 * by weekStart so rollover + on-demand calls never duplicate.
 */
export function generateWeeklyReport(
  ctx: AppContext,
  weekEnding = new Date().toISOString().slice(0, 10),
): { report: WeeklyReport; reportText: string } {
  const weekEnd = weekEnding;
  const weekStart = isoDaysBefore(weekEnd, 6);
  const inWindow = (isoDate: string) => {
    const day = isoDate.slice(0, 10);
    return day >= weekStart && day <= weekEnd;
  };

  const m = computeMetrics(ctx);
  const dailies = ctx.store.dailyMemories.list({ limit: 400 }).filter((d) => inWindow(d.date));
  const weekFailures = ctx.store.failures.list({ limit: 500 }).filter((f) => inWindow(f.createdAt));
  const failuresByCategory = new Map<string, number>();
  for (const f of weekFailures) failuresByCategory.set(f.category, (failuresByCategory.get(f.category) ?? 0) + 1);
  const findings = experimentFindings(ctx);

  const lessons: string[] = [];
  // A clear experiment winner with enough volume on EVERY arm becomes a durable lesson.
  for (const experiment of ctx.store.experiments.list({ status: "running", limit: 50 })) {
    if (experiment.dimension !== "outreach_variant") continue;
    const results = computeExperimentResults(ctx, experiment);
    const arms = experiment.variants.map((variant) => ({
      variant,
      sends: results.find((r) => r.variant === variant && r.metric === "sends")?.value ?? 0,
      replyRate: results.find((r) => r.variant === variant && r.metric === "reply_rate")?.value ?? 0,
    }));
    if (arms.length < 2 || arms.some((a) => a.sends < MIN_EXPERIMENT_SENDS_FOR_LESSON)) continue;
    const sorted = [...arms].sort((a, b) => b.replyRate - a.replyRate);
    const [leader, runnerUp] = [sorted[0]!, sorted[1]!];
    if (leader.replyRate <= runnerUp.replyRate) continue; // no clear winner
    const lesson = `Variant '${leader.variant}' outperforms '${runnerUp.variant}' on reply rate (${leader.replyRate}% vs ${runnerUp.replyRate}%) in experiment '${experiment.name}' (n=${leader.sends}/${runnerUp.sends}).`;
    ctx.memory.addLesson({ topic: "outreach", lesson, evidence: findings });
    lessons.push(lesson);
  }
  for (const [category, count] of failuresByCategory) {
    if (count < RECURRING_FAILURE_THRESHOLD) continue;
    const lesson = `Failure category '${category}' recurred ${count}x in the week of ${weekStart} — needs a root-cause fix, not retries.`;
    ctx.memory.addLesson({ topic: "process", lesson, evidence: weekFailures.filter((f) => f.category === category).slice(0, 5).map((f) => f.message) });
    lessons.push(lesson);
  }

  const wins = [...new Set(dailies.flatMap((d) => d.wins))].slice(0, 10);
  const openRequests = ctx.store.ownerRequests.list({ status: "open", limit: 50 });
  const bottlenecks = [
    ...(m.approvalsPending > 0 ? [`${m.approvalsPending} approval(s) waiting in Review Queue`] : []),
    ...openRequests.slice(0, 5).map((r) => `OwnerRequest open: ${r.title}`),
  ];
  const summary = `Week ${weekStart} → ${weekEnd}: ${m.leadsTotal} leads, ${m.leadsContacted} contacted, ${m.replies} replies (${m.positiveReplies} positive), ${m.opportunities} opportunities, ${m.previewsBuilt} previews, ${weekFailures.length} failures.`;

  const metrics: Record<string, number> = {
    leadsTotal: m.leadsTotal,
    contacted: m.leadsContacted,
    replyRate: m.replyRate,
    positiveReplyRate: m.positiveReplyRate,
    bounceRate: m.bounceRate,
    unsubscribeRate: m.unsubscribeRate,
    opportunities: m.opportunities,
    previews: m.previewsBuilt,
    failuresThisWeek: weekFailures.length,
    daysWithMemory: dailies.length,
  };

  const reportText = [
    `# William D'Amato — Weekly Report ${weekStart} → ${weekEnd}`,
    ``,
    summary,
    ``,
    `## Metrics`,
    `- Reply rate: ${m.replyRate}% | Positive: ${m.positiveReplyRate}% | Bounce: ${m.bounceRate}% | Unsub: ${m.unsubscribeRate}%`,
    `- Opportunities: ${m.opportunities} | Previews: ${m.previewsBuilt} | Failures this week: ${weekFailures.length}`,
    findings.length ? `## Experiments\n${findings.map((f) => `- ${f}`).join("\n")}` : "",
    lessons.length ? `## Lessons learned\n${lessons.map((l) => `- ${l}`).join("\n")}` : "",
    wins.length ? `## Wins\n${wins.map((w) => `- ${w}`).join("\n")}` : "",
    bottlenecks.length ? `## Needs you\n${bottlenecks.map((b) => `- ${b}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const existing = ctx.store.weeklyReports.list({ skey: weekStart, limit: 1 })[0];
  const now = nowIso();
  const record: WeeklyReport = {
    id: existing?.id ?? newId("wrep"),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    weekStart,
    weekEnd,
    summary,
    metrics,
    wins,
    bottlenecks,
    lessons,
    experimentFindings: findings,
    reportText,
  };
  const report = existing ? ctx.store.weeklyReports.save(record) : ctx.store.weeklyReports.insert(record);
  return { report, reportText };
}
