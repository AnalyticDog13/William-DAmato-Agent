/** Continuous orchestrator worker: processes the durable queue and writes the daily report at day rollover. */
import { loadDotEnv, newTraceId } from "@william/core";
import { createContext } from "./context";
import { ensureBootstrapOwnerRequests } from "./ownerRequests";
import { generateDailyReport, generateWeeklyReport } from "./reports";
import { runForever, processOne } from "./runner";

loadDotEnv(); // read .env (repo root) before config; no-op if absent
const ctx = createContext();
ensureBootstrapOwnerRequests(ctx);

let lastReportDate = new Date().toISOString().slice(0, 10);
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastReportDate) {
    generateDailyReport(ctx, lastReportDate);
    // Monday rollover: the finished week ends on yesterday (Sunday).
    if (new Date(`${today}T00:00:00Z`).getUTCDay() === 1) {
      generateWeeklyReport(ctx, lastReportDate);
      ctx.log.info("weekly report generated", { weekEnding: lastReportDate });
    }
    lastReportDate = today;
    ctx.log.info("daily report generated", { date: lastReportDate });
  }
}, 60_000).unref();

// Poll Instantly for inbound replies when enabled (free alternative to the
// Hypergrowth webhook). Each tick enqueues a durable instantly.pollReplies job;
// disabled by default and inert in local (dry-run → pollInbound returns []).
if (ctx.config.instantlyPollIntervalMs > 0) {
  const enqueuePoll = () =>
    ctx.store.queue.enqueue({ type: "instantly.pollReplies", payload: {}, traceId: newTraceId() });
  enqueuePoll(); // poll once on startup
  setInterval(enqueuePoll, ctx.config.instantlyPollIntervalMs).unref();
  ctx.log.info("instantly reply polling enabled", { intervalMs: ctx.config.instantlyPollIntervalMs });
}

runForever(ctx).catch((err) => {
  ctx.log.error("worker crashed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

export { processOne };
