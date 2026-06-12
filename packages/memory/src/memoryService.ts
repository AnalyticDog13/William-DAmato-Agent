import {
  newId,
  nowIso,
  type DailyMemory,
  type DurableLesson,
  type FailureLog,
  type OwnerRequest,
} from "@william/core";
import type { Store } from "@william/db";

export interface OwnerRequestInput {
  title: string;
  whyItMatters: string;
  neededFields: string[];
  credentialKind: OwnerRequest["credentialKind"];
  unblocks: string[];
  category: OwnerRequest["category"];
}

/**
 * Runtime business memory. Distinct from build-time Claude Code memory:
 * this is what William learned about *the business* — wins, failures,
 * lessons, experiments, and what the owner still needs to provide.
 */
export class MemoryService {
  constructor(private readonly store: Store) {}

  recordFailure(input: Omit<FailureLog, "id" | "createdAt" | "updatedAt">): FailureLog {
    const now = nowIso();
    return this.store.failures.insert({ ...input, id: newId("fail"), createdAt: now, updatedAt: now });
  }

  /**
   * Creates an OwnerRequest unless an open one with the same title exists.
   * This is the "blocked ≠ stuck" mechanism: every missing credential or
   * decision becomes a concrete, actionable record for the owner.
   */
  requestFromOwner(input: OwnerRequestInput): OwnerRequest {
    const existing = this.store.ownerRequests
      .list({ status: "open", limit: 500 })
      .find((r) => r.title === input.title);
    if (existing) return existing;
    const now = nowIso();
    const request: OwnerRequest = {
      ...input,
      id: newId("oreq"),
      createdAt: now,
      updatedAt: now,
      status: "open",
      resolvedNote: "",
    };
    this.store.ownerRequests.insert(request);
    this.store.writeAudit({
      traceId: newId("trc"),
      actor: "system",
      action: "owner_request.created",
      subjectType: "OwnerRequest",
      subjectId: request.id,
      leadId: null,
      gate: null,
      outcome: "recorded",
      detail: input.title,
    });
    return request;
  }

  addLesson(input: {
    topic: DurableLesson["topic"];
    lesson: string;
    evidence?: string[];
    confidence?: number;
  }): DurableLesson {
    // Re-learning the same lesson strengthens it instead of duplicating it.
    const existing = this.store.lessons
      .list({ skey: input.topic, limit: 500 })
      .find((l) => l.lesson === input.lesson && !l.supersededBy);
    if (existing) {
      return this.store.lessons.save({
        ...existing,
        timesConfirmed: existing.timesConfirmed + 1,
        confidence: Math.min(1, existing.confidence + 0.1),
        evidence: [...existing.evidence, ...(input.evidence ?? [])].slice(-20),
      });
    }
    const now = nowIso();
    return this.store.lessons.insert({
      id: newId("les"),
      createdAt: now,
      updatedAt: now,
      topic: input.topic,
      lesson: input.lesson,
      evidence: input.evidence ?? [],
      confidence: input.confidence ?? 0.5,
      timesConfirmed: 1,
      supersededBy: null,
    });
  }

  /** Write (or overwrite) the daily memory entry for a date (YYYY-MM-DD). */
  writeDailyMemory(date: string, content: Omit<DailyMemory, "id" | "createdAt" | "updatedAt" | "date">): DailyMemory {
    const existing = this.store.dailyMemories.list({ skey: date, limit: 1 })[0];
    const now = nowIso();
    const entry: DailyMemory = existing
      ? { ...existing, ...content, updatedAt: now }
      : { ...content, id: newId("dmem"), createdAt: now, updatedAt: now, date };
    return this.store.dailyMemories.save(entry);
  }

  /** Heuristic improvement proposals from recent failures + open requests. */
  generateRecommendations(): string[] {
    const recs: string[] = [];
    const failures = this.store.failures.list({ limit: 200 });
    const byCategory = new Map<string, number>();
    for (const f of failures) byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
    for (const [category, count] of byCategory) {
      if (count >= 3) recs.push(`Recurring failures (${count}x) in '${category}' — investigate root cause.`);
    }
    const openRequests = this.store.ownerRequests.list({ status: "open", limit: 100 });
    if (openRequests.length > 0) {
      recs.push(
        `${openRequests.length} open owner request(s) are blocking progress — top: ${openRequests[0]!.title}`,
      );
    }
    const deadJobs = this.store.queue.list({ status: "dead", limit: 50 });
    if (deadJobs.length > 0) {
      recs.push(`${deadJobs.length} dead-lettered job(s) need manual review in Failures/Logs.`);
    }
    return recs;
  }
}
