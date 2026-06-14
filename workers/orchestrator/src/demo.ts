/**
 * End-to-end DRY-RUN demo: seeds realistic leads and walks the entire
 * pipeline — intake → audit → score → contact → draft → owner approval →
 * (simulated) send → replies → opportunity → website brief (owner builds) →
 * ship (owner's repo, simulated) → delivery email → billing draft → approval →
 * (simulated) payment link → daily report.
 *
 * Run: npm run demo
 * Everything is simulated; no external call leaves the machine.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { newTraceId } from "@william/core";
import { decideApproval, requestApproval } from "./approvals";
import { createContext } from "./context";
import { generateDailyReport } from "./reports";
import { runUntilEmpty } from "./runner";
import { seedDemoData } from "./seed";

const futureClock = () => new Date(Date.now() + 10 * 60_000); // hop over retry backoff

async function main(): Promise<void> {
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

  // 4) Replies arrive (webhook-equivalent): one positive, one opt-out
  const [first, second] = toApprove;
  if (first?.leadId) {
    ctx.store.queue.enqueue({
      type: "reply.process",
      payload: { leadId: first.leadId, text: "This sounds interesting — send the mockup, what would it cost?", provider: "instantly" },
      traceId: newTraceId(),
      leadId: first.leadId,
    });
  }
  if (second?.leadId) {
    ctx.store.queue.enqueue({
      type: "reply.process",
      payload: { leadId: second.leadId, text: "I'm not interested, please remove me.", provider: "instantly" },
      traceId: newTraceId(),
      leadId: second.leadId,
    });
  }
  await runUntilEmpty(ctx, 100, futureClock);
  const opp = ctx.store.opportunities.list()[0];
  say(`4) Replies processed: ${ctx.store.replyEvents.count()} total → ${ctx.store.replyEvents.count({ status: "positive" })} positive (opportunity created, owner notified, call slots suggested, website brief generated), ${ctx.store.replyEvents.count({ status: "unsubscribe" })} unsubscribe honored → do-not-contact.`);
  const brief = ctx.store.websiteBriefs.list()[0];
  if (brief) say(`   📋 Website brief generated for the owner (target ${brief.targetModel}, ${brief.weaknesses.length} weaknesses to fix) — paste into Fable/Opus to build.\n`);

  // 4b) Owner builds the site externally, marks it ready with a repo URL → ship
  //     (dry-run prod deploy) → delivery email drafted for approval.
  if (brief) {
    ctx.store.websiteBriefs.save({ ...brief, repoUrl: "https://github.com/owner/demo-site" });
    const shipApproval = requestApproval(ctx, {
      gate: "DEPLOY_PRODUCTION",
      subjectType: "WebsiteBrief",
      subjectId: brief.id,
      leadId: brief.leadId,
      title: "demo: ship owner-built site",
      detail: "https://github.com/owner/demo-site",
      traceId: newTraceId(),
    });
    decideApproval(ctx, shipApproval.id, "granted", "demo: owner approved the ship");
    ctx.store.queue.enqueue({ type: "site.ship", payload: { websiteBriefId: brief.id, approvalRequestId: shipApproval.id }, traceId: shipApproval.traceId, leadId: brief.leadId });
    await runUntilEmpty(ctx, 50, futureClock);
    const shipped = ctx.store.websiteBriefs.get(brief.id);
    const delivery = ctx.store.outreachDrafts.list().find((d) => d.variant === "delivery-1");
    say(`4b) Owner shipped the finished repo → brief is ${shipped?.status} (production deploy SIMULATED), delivery email ${delivery ? "drafted (awaiting owner approval)" : "not drafted"}.\n`);
  }

  // 5) Billing draft + approval
  if (opp) {
    ctx.store.queue.enqueue({
      type: "billing.draft",
      payload: { leadId: opp.leadId, opportunityId: opp.id, kind: "payment_link", description: "Website design & build — 50% deposit", amountUsd: 400 },
      traceId: newTraceId(),
      leadId: opp.leadId,
    });
    await runUntilEmpty(ctx, 50, futureClock);
    const payApproval = ctx.store.approvals.list({ status: "pending", skey: "SEND_PAYMENT_REQUEST" })[0];
    if (payApproval) {
      decideApproval(ctx, payApproval.id, "granted", "demo: owner approved payment request");
      ctx.store.queue.enqueue({
        type: "billing.execute",
        payload: { invoiceDraftId: payApproval.subjectId },
        traceId: payApproval.traceId,
        leadId: payApproval.leadId,
      });
      await runUntilEmpty(ctx, 50, futureClock);
    }
    const invoice = ctx.store.invoiceDrafts.list()[0];
    say(`5) Billing: payment link draft → owner approved → executed as ${invoice?.status} ${invoice?.url ? `(${invoice.url})` : ""}.\n`);
  }

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
