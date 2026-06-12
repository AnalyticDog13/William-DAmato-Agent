import { z } from "zod";
import { BaseEntity, Id, IsoDate } from "./common";

export const OpportunityStage = z.enum([
  "new_interest",
  "preview_in_progress",
  "preview_shared",
  "call_pending",
  "proposal_sent",
  "payment_pending",
  "won",
  "lost",
]);
export type OpportunityStage = z.infer<typeof OpportunityStage>;

export const Opportunity = BaseEntity.extend({
  leadId: Id,
  stage: OpportunityStage,
  valueUsd: z.number().nullable().default(null),
  threadSummary: z.string().default(""),
  recommendedNextStep: z.string().default(""),
  lostReason: z.string().nullable().default(null),
  history: z
    .array(z.object({ at: IsoDate, stage: OpportunityStage, note: z.string().default("") }))
    .default([]),
});
export type Opportunity = z.infer<typeof Opportunity>;

export const CallSuggestion = BaseEntity.extend({
  leadId: Id,
  opportunityId: Id.nullable(),
  reason: z.string(),
  suggestedSlots: z.array(z.object({ start: IsoDate, end: IsoDate })).default([]),
  /** Owner schedules the call themselves via will@williamdamato.com. */
  status: z.enum(["pending_owner", "owner_notified", "scheduled_by_owner", "dismissed"]),
  ownerNotifiedAt: IsoDate.nullable().default(null),
});
export type CallSuggestion = z.infer<typeof CallSuggestion>;

export const BookingRecord = BaseEntity.extend({
  leadId: Id,
  callSuggestionId: Id.nullable(),
  scheduledFor: IsoDate,
  durationMinutes: z.number().default(30),
  location: z.string().default("Google Meet"),
  outcome: z.enum(["upcoming", "completed", "no_show", "cancelled"]).default("upcoming"),
  notes: z.string().default(""),
});
export type BookingRecord = z.infer<typeof BookingRecord>;
