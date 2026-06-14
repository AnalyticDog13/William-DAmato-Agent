/** Continuous orchestrator worker: processes the durable queue and writes the daily report at day rollover. */
import { loadDotEnv } from "@william/core";
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

runForever(ctx).catch((err) => {
  ctx.log.error("worker crashed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

export { processOne };
