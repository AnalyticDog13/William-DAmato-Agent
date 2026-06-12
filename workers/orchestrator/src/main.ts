/** Continuous orchestrator worker: processes the durable queue and writes the daily report at day rollover. */
import { createContext } from "./context";
import { ensureBootstrapOwnerRequests } from "./ownerRequests";
import { generateDailyReport } from "./reports";
import { runForever, processOne } from "./runner";

const ctx = createContext();
ensureBootstrapOwnerRequests(ctx);

let lastReportDate = new Date().toISOString().slice(0, 10);
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastReportDate) {
    generateDailyReport(ctx, lastReportDate);
    lastReportDate = today;
    ctx.log.info("daily report generated", { date: lastReportDate });
  }
}, 60_000).unref();

runForever(ctx).catch((err) => {
  ctx.log.error("worker crashed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

export { processOne };
