import type { Lead, LeadStatus } from "@william/core";
import type { AppContext } from "./context";

/**
 * Statuses where a lead is still moving through contact→audit→score→draft AND
 * will change state on its own via the queue.
 *
 * A lead is in-flight ONLY while a downstream job will still advance it. Once a
 * lead reaches `scored` its sourcing outcome is DECIDED: it either scored above
 * the threshold (an `outreach.draft` job is already enqueued and it will become
 * `draft_ready`, counted by countQualified) or it scored at/below the threshold
 * and is KEPT-NOT-EMAILED — it stays `scored` permanently with no draft. A
 * below-threshold lead therefore never leaves `scored`, so counting `scored` as
 * in-flight made the controller wait on it forever: it re-enqueued every tick,
 * never sourced the next page or advanced the niche sweep, exhausted its check
 * cap, and ended `failed`. That froze every large batch run that ingested even
 * one below-threshold lead. `scored` is thus resolved for sourcing purposes.
 *
 * (Same failure mode previously fixed for `draft_ready` / `approved_for_send`,
 * which are likewise resolved — they already have a draft.)
 *
 * Everything from `scored` onward is resolved: it has a draft (counted by
 * countQualified) or is below-threshold-kept, terminal-negative (disqualified /
 * not_interested / do_not_contact), or post-contact (contacted / replied /
 * opportunity / customer).
 */
export const IN_FLIGHT_STATUSES: ReadonlySet<LeadStatus> = new Set<LeadStatus>([
  "new",
  "auditing",
  "audited",
  "contact_ready",
]);

/** A lead has exited the active pipeline (it resolved — successfully or not). */
export function leadResolved(lead: Lead): boolean {
  return !IN_FLIGHT_STATUSES.has(lead.status);
}

/**
 * Count leads that have an outreach draft AND whose latest score exceeds minScore.
 * The store returns rows newest-first (ORDER BY created_at DESC), so [0] is the
 * most recent score — correct for a lead that may have been re-scored.
 */
export function countQualified(ctx: AppContext, leadIds: string[], minScore: number): number {
  let n = 0;
  for (const id of leadIds) {
    const hasDraft = ctx.store.outreachDrafts.list({ leadId: id }).length > 0;
    if (!hasDraft) continue;
    const latestScore = ctx.store.leadScores.list({ leadId: id })[0]?.score ?? 0;
    if (latestScore > minScore) n += 1;
  }
  return n;
}
