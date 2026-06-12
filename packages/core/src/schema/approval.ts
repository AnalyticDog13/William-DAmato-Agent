import { z } from "zod";
import { BaseEntity, Id, IsoDate } from "./common";

export const PolicyGateName = z.enum([
  "SEND_FIRST_TOUCH",
  "ACTIVATE_NEW_LEAD_SOURCE",
  "ENABLE_SOCIAL_SOURCE",
  "SEND_PAYMENT_REQUEST",
  "DEPLOY_PRODUCTION",
  "UPDATE_LIVE_COPY",
  "CHANGE_COMPLIANCE_TEXT",
  "ENABLE_FULL_AUTONOMY",
]);
export type PolicyGateName = z.infer<typeof PolicyGateName>;

export const ApprovalRequest = BaseEntity.extend({
  gate: PolicyGateName,
  /** What is being approved, e.g. outreach draft id, deployment id. */
  subjectType: z.string(),
  subjectId: Id,
  leadId: Id.nullable().default(null),
  title: z.string(),
  detail: z.string(),
  requestedBy: z.literal("system"),
  status: z.enum(["pending", "granted", "rejected", "expired", "revoked"]),
  decidedAt: IsoDate.nullable().default(null),
  decidedBy: z.enum(["owner"]).nullable().default(null),
  decisionNote: z.string().default(""),
  expiresAt: IsoDate.nullable().default(null),
  traceId: z.string(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

/** Per-gate owner-configurable policy. Defaults are maximally safe. */
export const GatePolicy = z.object({
  gate: PolicyGateName,
  /** closed = never allowed; approval = per-action ApprovalRequest; autopilot = pre-authorized */
  mode: z.enum(["closed", "approval", "autopilot"]).default("approval"),
  note: z.string().default(""),
  updatedAt: IsoDate,
});
export type GatePolicy = z.infer<typeof GatePolicy>;
