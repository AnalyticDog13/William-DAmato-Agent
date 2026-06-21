import type { Lead, LeadStatus } from "@william/core";
import type { AppContext } from "./context";

/**
 * Statuses where a lead is still moving through audit→contact→score→draft.
 *
 * A lead is in-flight ONLY while it is still being audited/scored/drafted.
 * Once it reaches `draft_ready` it HAS a draft (its sourcing outcome is known)
 * and will NOT advance further during a run — sending requires owner approval
 * + a gated SEND_FIRST_TOUCH send, which does not happen mid-run. Counting
 * `draft_ready` or `approved_for_send` as in-flight would cause the controller
 * to wait forever on those leads and never source the next page, eventually
 * exhausting its check cap and failing without ever reaching its target.
 *
 * Everything from `draft_ready` onward is resolved for sourcing purposes:
 * either it has a draft (counted by countQualified), or it is terminal-negative
 * (disqualified / not_interested / do_not_contact), or it is post-contact
 * (contacted / replied / opportunity / customer).
 */
export const IN_FLIGHT_STATUSES: ReadonlySet<LeadStatus> = new Set<LeadStatus>([
  "new",
  "auditing",
  "audited",
  "scored",
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
