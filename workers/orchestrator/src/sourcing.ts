import type { Lead, LeadStatus } from "@william/core";
import type { AppContext } from "./context";

/** Statuses where a lead is still moving through audit→contact→score→draft. */
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
