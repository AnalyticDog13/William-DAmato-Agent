/**
 * End-to-end DRY-RUN demo: seeds realistic leads and walks the outreach
 * pipeline — intake → audit → score → contact → draft → owner approval →
 * (simulated) send → daily report.
 *
 * Run: npm run demo
 * Everything is simulated; no external call leaves the machine.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { decideApproval } from "./approvals";
import { createContext } from "./context";
import { generateDailyReport } from "./reports";
import { runUntilEmpty } from "./runner";
import { seedDemoData } from "./seed";

const futureClock = () => new Date(Date.now() + 10 * 60_000); // hop over retry backoff

async function main(): Promise<void> {
  // NOTE: the demo deliberately does NOT load .env — it is a hermetic dry-run
  // showcase ("no external call leaves the machine"). Real creds/staging belong
  // to the worker/api/seed entry points, not here.
  // Fresh demo database every run.
  const dataDir = process.env.DATA_DIR ?? "./data";
  for (const f of ["william.db", "william.db-wal", "william.db-shm"]) {
    try { rmSync(join(dataDir, f)); } catch { /* first run */ }
  }
  const ctx = createContext({ silent: true });
  const say = (msg: string) => console.log(msg);

  say("══════════════════════════════════════════════════════════════");
  say(" WILLIAM D'AMATO — end-to-end dry-run demo");
  say(` env=${ctx.config.env} dryRun=${ctx.config.dryRun} auditor=${ctx.config.auditorMode}`);
  say("══════════════════════════════════════════════════════════════\n");

  // 1) Intake
  const seeded = seedDemoData(ctx);
  say(`1) Lead intake: ${seeded.created} created, ${seeded.duplicates} duplicate(s) rejected, ${seeded.blocked} blocked by do-not-contact.`);

  // 2) Audit → score → contact → draft
  const processed = await runUntilEmpty(ctx, 500, futureClock);
  const pendingApprovals = ctx.store.approvals.list({ status: "pending", skey: "SEND_FIRST_TOUCH" });
  say(`2) Pipeline ran ${processed} jobs → ${ctx.store.audits.count()} audits, ${ctx.store.leadScores.count()} scores, ${ctx.store.outreachDrafts.count()} outreach drafts.`);
  say(`   ${pendingApprovals.length} first-touch drafts now wait in the Review Queue (nothing sends without you).\n`);

  // 3) Owner approves two drafts (simulating dashboard clicks)
  const toApprove = pendingApprovals.slice(0, 2);
  for (const approval of toApprove) {
    decideApproval(ctx, approval.id, "granted", "demo: owner approved in dashboard");
    ctx.store.queue.enqueue({
      type: "outreach.send",
      payload: { draftId: approval.subjectId },
      traceId: approval.traceId,
      leadId: approval.leadId,
    });
  }
  await runUntilEmpty(ctx, 100, futureClock);
  say(`3) Owner approved ${toApprove.length} drafts → sends executed as DRY-RUN (mock Instantly): ${ctx.store.campaignSyncs.count()} campaign sync record(s).\n`);

  // 6) Daily report + memory
  const { reportText } = generateDailyReport(ctx);
  say("6) Daily report written to memory:\n");
  say(reportText.split("\n").map((l) => `   ${l}`).join("\n"));

  // 7) Safety + bookkeeping summary
  say("\n──────────────────────────────────────────────────────────────");
  say(" Safety & bookkeeping");
  say("──────────────────────────────────────────────────────────────");
  say(` Audit-log entries:        ${ctx.store.auditLog.count()}`);
  say(` Compliance events:        ${ctx.store.complianceEvents.count()} (${ctx.store.complianceEvents.list().map((c) => c.kind).join(", ")})`);
  say(` Open owner requests:      ${ctx.store.ownerRequests.count({ status: "open" })}`);
  for (const r of ctx.store.ownerRequests.list({ status: "open", limit: 10 })) say(`   • ${r.title}`);
  say(` Dead-letter jobs:         ${ctx.store.queue.list({ status: "dead" }).length}`);
  say("\nDemo complete. Start the dashboard with:  npm run dev:api  +  npm run dev:dashboard");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
