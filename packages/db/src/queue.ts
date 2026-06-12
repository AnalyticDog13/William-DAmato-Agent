import { newId, nowIso, type Job } from "@william/core";
import type { Db } from "./database";

export interface EnqueueOptions {
  type: string;
  payload: Record<string, unknown>;
  traceId: string;
  leadId?: string | null;
  /** Delay in ms before the job becomes runnable. */
  delayMs?: number;
  maxAttempts?: number;
}

/**
 * Durable job queue on SQLite. Jobs survive restarts, retry with exponential
 * backoff, and dead-letter after maxAttempts. The workflow engine of the
 * system — intentionally boring and fully observable from the dashboard.
 */
export class JobQueue {
  constructor(private readonly db: Db) {}

  enqueue(opts: EnqueueOptions): Job {
    const now = nowIso();
    const job: Job = {
      id: newId("job"),
      type: opts.type,
      payload: opts.payload,
      status: "pending",
      traceId: opts.traceId,
      leadId: opts.leadId ?? null,
      runAt: new Date(Date.now() + (opts.delayMs ?? 0)).toISOString(),
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 3,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO jobs (id, type, payload, status, trace_id, lead_id, run_at, attempts, max_attempts, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.id,
        job.type,
        JSON.stringify(job.payload),
        job.status,
        job.traceId,
        job.leadId,
        job.runAt,
        job.attempts,
        job.maxAttempts,
        job.lastError,
        job.createdAt,
        job.updatedAt,
      );
    return job;
  }

  /** Atomically claim the next runnable job (single-process worker model). */
  claimNext(now: Date = new Date()): Job | null {
    const row = this.db
      .prepare(
        `SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ?
         ORDER BY run_at ASC LIMIT 1`,
      )
      .get(now.toISOString()) as Record<string, unknown> | undefined;
    if (!row) return null;
    const res = this.db
      .prepare(
        `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(nowIso(), row.id as string);
    if (res.changes === 0) return null; // raced; caller retries
    return this.rowToJob({ ...row, status: "running", attempts: (row.attempts as number) + 1 });
  }

  complete(jobId: string): void {
    this.setStatus(jobId, "succeeded", null);
  }

  /** Retry with exponential backoff, or dead-letter when attempts exhausted. */
  fail(jobId: string, error: string): "retried" | "dead" {
    const row = this.db.prepare(`SELECT attempts, max_attempts FROM jobs WHERE id = ?`).get(jobId) as
      | { attempts: number; max_attempts: number }
      | undefined;
    if (!row) return "dead";
    if (row.attempts >= row.max_attempts) {
      this.setStatus(jobId, "dead", error);
      return "dead";
    }
    const backoffMs = Math.min(60_000, 1000 * 2 ** row.attempts);
    this.db
      .prepare(`UPDATE jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`)
      .run(error, nowIso(), jobId);
    this.db
      .prepare(`UPDATE jobs SET status = 'pending', run_at = ?, updated_at = ? WHERE id = ?`)
      .run(new Date(Date.now() + backoffMs).toISOString(), nowIso(), jobId);
    return "retried";
  }

  cancel(jobId: string): void {
    this.setStatus(jobId, "cancelled", null);
  }

  private setStatus(jobId: string, status: string, error: string | null): void {
    this.db
      .prepare(`UPDATE jobs SET status = ?, last_error = COALESCE(?, last_error), updated_at = ? WHERE id = ?`)
      .run(status, error, nowIso(), jobId);
  }

  list(filter: { status?: string; traceId?: string; limit?: number } = {}): Job[] {
    const where: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.traceId) {
      where.push("trace_id = ?");
      params.push(filter.traceId);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM jobs WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...(params as never[]), Math.min(filter.limit ?? 200, 1000)) as Record<string, unknown>[];
    return rows.map((r) => this.rowToJob(r));
  }

  countPending(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending'`).get() as {
      n: number;
    };
    return row.n;
  }

  private rowToJob(row: Record<string, unknown>): Job {
    return {
      id: row.id as string,
      type: row.type as string,
      payload: JSON.parse(row.payload as string),
      status: row.status as Job["status"],
      traceId: row.trace_id as string,
      leadId: (row.lead_id as string | null) ?? null,
      runAt: row.run_at as string,
      attempts: row.attempts as number,
      maxAttempts: row.max_attempts as number,
      lastError: (row.last_error as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
