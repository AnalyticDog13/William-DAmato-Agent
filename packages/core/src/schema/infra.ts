import { z } from "zod";
import { BaseEntity, Id, IsoDate } from "./common";
import { PolicyGateName } from "./approval";

export const AuditLogEntry = BaseEntity.extend({
  traceId: z.string(),
  actor: z.enum(["system", "owner", "webhook"]),
  action: z.string(),
  subjectType: z.string().nullable().default(null),
  subjectId: z.string().nullable().default(null),
  leadId: Id.nullable().default(null),
  gate: PolicyGateName.nullable().default(null),
  outcome: z.enum(["allowed", "denied", "dry_run", "executed", "recorded"]),
  detail: z.string().default(""),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

export const ComplianceEvent = BaseEntity.extend({
  kind: z.enum([
    "unsubscribe_honored",
    "dnc_blocked",
    "robots_respected",
    "webhook_signature_invalid",
    "webhook_unsigned_accepted_dry_run",
    "data_source_refused",
    "email_instruction_ignored",
  ]),
  detail: z.string(),
  leadId: Id.nullable().default(null),
  traceId: z.string().nullable().default(null),
});
export type ComplianceEvent = z.infer<typeof ComplianceEvent>;

export const IntegrationCredentialStatus = BaseEntity.extend({
  integration: z.enum([
    "instantly",
    "gmail",
    "stripe",
    "vercel",
    "github",
    "google_maps",
    "enrichment",
    "email_verify",
    "calendar",
    "higgsfield",
    "firecrawl",
    "anthropic",
  ]),
  mode: z.enum(["missing", "sandbox", "live"]),
  healthy: z.boolean().nullable().default(null),
  lastCheckedAt: IsoDate.nullable().default(null),
  detail: z.string().default(""),
});
export type IntegrationCredentialStatus = z.infer<typeof IntegrationCredentialStatus>;

export const WebhookEventRecord = BaseEntity.extend({
  provider: z.enum(["instantly", "stripe", "vercel", "other"]),
  eventType: z.string(),
  signatureValid: z.boolean().nullable(),
  payload: z.string(),
  processed: z.boolean().default(false),
  processingError: z.string().nullable().default(null),
});
export type WebhookEventRecord = z.infer<typeof WebhookEventRecord>;

/** Per-lead activity timeline entry; powers the dashboard timeline view. */
export const ActivityEvent = BaseEntity.extend({
  leadId: Id,
  traceId: z.string().nullable().default(null),
  kind: z.string(),
  message: z.string(),
  byApproval: z.boolean().default(false),
  data: z.record(z.unknown()).default({}),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const JobStatus = z.enum(["pending", "running", "succeeded", "failed", "dead", "cancelled"]);

export const Job = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.record(z.unknown()),
  status: JobStatus,
  traceId: z.string(),
  leadId: Id.nullable().default(null),
  runAt: IsoDate,
  attempts: z.number().int().default(0),
  maxAttempts: z.number().int().default(3),
  lastError: z.string().nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Job = z.infer<typeof Job>;
