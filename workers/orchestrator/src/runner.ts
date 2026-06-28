import { JOB_HANDLERS } from "./pipelines";
import type { AppContext } from "./context";

/** Processes one job. Returns false when the queue had nothing runnable. */
export async function processOne(ctx: AppContext, now?: Date): Promise<boolean> {
  const job = ctx.store.queue.claimNext(now);
  if (!job) return false;
  const log = ctx.log.child({ jobId: job.id, traceId: job.traceId, jobType: job.type });
  const handler = JOB_HANDLERS[job.type];
  if (!handler) {
    ctx.store.queue.fail(job.id, `No handler for job type ${job.type}`);
    ctx.memory.recordFailure({
      traceId: job.traceId,
      leadId: job.leadId,
      jobId: job.id,
      category: "bug",
      message: `No handler registered for job type '${job.type}'`,
      stack: null,
      retryable: false,
    });
    return true;
  }
  try {
    await handler(ctx, job);
    ctx.store.queue.complete(job.id);
    log.info("job succeeded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const outcome = ctx.store.queue.fail(job.id, message);
    log.error("job failed", { error: message, outcome });
    ctx.memory.recordFailure({
      traceId: job.traceId,
      leadId: job.leadId,
      jobId: job.id,
      category: categorize(message),
      message,
      stack: err instanceof Error ? (err.stack ?? null) : null,
      retryable: outcome === "retried",
    });
  }
  return true;
}

function categorize(message: string): "policy_denied" | "missing_credentials" | "validation" | "timeout" | "unknown" {
  if (/blocked by policy|blocked:/i.test(message)) return "policy_denied";
  if (/credential|api key|unauthorized/i.test(message)) return "missing_credentials";
  if (/not found|missing|invalid|failed content rules/i.test(message)) return "validation";
  if (/timeout|timed out/i.test(message)) return "timeout";
  return "unknown";
}

/** Drains the queue (demo/tests). `clock` lets callers fast-forward past retry backoff. */
export async function runUntilEmpty(ctx: AppContext, maxJobs = 500, clock?: () => Date): Promise<number> {
  let processed = 0;
  while (processed < maxJobs) {
    const didWork = await processOne(ctx, clock?.());
    if (!didWork) break;
    processed++;
  }
  return processed;
}

/** Continuous worker loop for `npm run worker`. */
export async function runForever(ctx: AppContext, pollMs = 1000): Promise<never> {
  // Single-process model: any 'running' job at startup is an orphan from a prior
  // run that stopped mid-job (claimNext only picks 'pending', so it would be
  // stranded forever — e.g. an approved send that never reaches Instantly).
  const reclaimed = ctx.store.queue.reclaimRunning();
  if (reclaimed > 0) ctx.log.warn("reclaimed orphaned running jobs from a previous worker run", { count: reclaimed });
  ctx.log.info("orchestrator worker started", { env: ctx.config.env, dryRun: ctx.config.dryRun });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const didWork = await processOne(ctx);
    if (!didWork) await new Promise((r) => setTimeout(r, pollMs));
  }
}
