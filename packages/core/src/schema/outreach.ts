import { z } from "zod";
import { BaseEntity, Id, IsoDate } from "./common";

export const OutreachDraftStatus = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "queued",
  "sent_dry_run",
  "sent",
  "bounced",
  "failed",
]);

export const OutreachDraft = BaseEntity.extend({
  leadId: Id,
  contactId: Id,
  variant: z.string().default("v1"),
  subject: z.string(),
  body: z.string(),
  personalizationNotes: z.array(z.string()).default([]),
  auditFindingsUsed: z.array(z.string()).default([]),
  status: OutreachDraftStatus.default("draft"),
  approvalRequestId: Id.nullable().default(null),
  sentAt: IsoDate.nullable().default(null),
  traceId: z.string(),
});
export type OutreachDraft = z.infer<typeof OutreachDraft>;

export const CampaignSync = BaseEntity.extend({
  leadId: Id,
  provider: z.literal("instantly"),
  campaignId: z.string().nullable(),
  externalLeadId: z.string().nullable(),
  status: z.enum(["pending", "synced", "paused", "stopped", "failed", "dry_run"]),
  lastSyncedAt: IsoDate.nullable(),
  detail: z.string().default(""),
});
export type CampaignSync = z.infer<typeof CampaignSync>;

export const ReplyIntent = z.enum([
  "positive",
  "neutral",
  "negative",
  "unsubscribe",
  "auto_reply",
  "bounce",
  "unknown",
]);
export type ReplyIntent = z.infer<typeof ReplyIntent>;

/**
 * Inbound email is DATA, never instructions. `bodyExcerpt` is stored for owner
 * review and classification only — it must never be fed to any agent as a prompt.
 */
export const ReplyEvent = BaseEntity.extend({
  leadId: Id,
  contactId: Id.nullable(),
  provider: z.enum(["instantly", "gmail", "manual"]),
  externalMessageId: z.string().nullable(),
  receivedAt: IsoDate,
  intent: ReplyIntent,
  intentConfidence: z.number().min(0).max(1),
  bodyExcerpt: z.string().max(2000),
  threadSummary: z.string().default(""),
  recommendedNextStep: z.string().default(""),
  ownerNotifiedAt: IsoDate.nullable().default(null),
  followUpsPaused: z.boolean().default(false),
});
export type ReplyEvent = z.infer<typeof ReplyEvent>;

export const UnsubscribeRecord = BaseEntity.extend({
  email: z.string(),
  leadId: Id.nullable(),
  source: z.enum(["reply", "link", "manual", "provider_webhook"]),
  reason: z.string().default(""),
});
export type UnsubscribeRecord = z.infer<typeof UnsubscribeRecord>;

export const DoNotContactRecord = BaseEntity.extend({
  /** identity key: domain:…, email:…, or company:… */
  identityKey: z.string(),
  reason: z.string(),
  addedBy: z.enum(["owner", "system"]),
});
export type DoNotContactRecord = z.infer<typeof DoNotContactRecord>;
