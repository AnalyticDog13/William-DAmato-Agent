import {
  newId,
  nowIso,
  type CallSuggestion,
  type Lead,
  type PolicyTicket,
} from "@william/core";
import type { CalendarAdapter } from "@william/integrations";

/**
 * Scheduling policy (per owner spec): William NEVER books calls. It computes
 * suggested free slots and notifies the owner, who logs into
 * will@williamdamato.com and schedules the call personally.
 */
export async function suggestCall(
  lead: Lead,
  reason: string,
  calendar: CalendarAdapter,
  ticket: PolicyTicket,
  opportunityId?: string | null,
): Promise<CallSuggestion> {
  const from = new Date();
  const to = new Date(from.getTime() + 3 * 24 * 60 * 60 * 1000);
  const busy = await calendar.freeBusy(ticket, { fromIso: from.toISOString(), toIso: to.toISOString() });

  // Suggest up to 3 one-hour weekday slots (10:00/14:00/16:00) avoiding busy blocks.
  const slots: { start: string; end: string }[] = [];
  for (let day = 1; day <= 3 && slots.length < 3; day++) {
    for (const hour of [10, 14, 16]) {
      const start = new Date(from);
      start.setDate(start.getDate() + day);
      if (start.getDay() === 0 || start.getDay() === 6) continue;
      start.setHours(hour, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const overlaps = busy.some(
        (b) => new Date(b.start) < end && new Date(b.end) > start,
      );
      if (!overlaps && slots.length < 3) {
        slots.push({ start: start.toISOString(), end: end.toISOString() });
      }
    }
  }

  const now = nowIso();
  return {
    id: newId("call"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    opportunityId: opportunityId ?? null,
    reason,
    suggestedSlots: slots,
    status: "owner_notified",
    ownerNotifiedAt: now,
  };
}
