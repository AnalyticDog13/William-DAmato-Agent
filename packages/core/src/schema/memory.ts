import { z } from "zod";
import { BaseEntity, Id, IsoDate } from "./common";

export const FailureLog = BaseEntity.extend({
  traceId: z.string(),
  leadId: Id.nullable().default(null),
  jobId: z.string().nullable().default(null),
  /** Failure taxonomy keeps metrics meaningful. */
  category: z.enum([
    "integration_auth",
    "integration_rate_limit",
    "integration_error",
    "validation",
    "policy_denied",
    "missing_credentials",
    "crawl_blocked",
    "timeout",
    "bug",
    "unknown",
  ]),
  message: z.string(),
  stack: z.string().nullable().default(null),
  retryable: z.boolean().default(false),
});
export type FailureLog = z.infer<typeof FailureLog>;

export const Experiment = BaseEntity.extend({
  name: z.string(),
  hypothesis: z.string(),
  dimension: z.enum(["niche", "template", "outreach_variant", "lead_source", "other"]),
  variants: z.array(z.string()).min(1),
  status: z.enum(["planned", "running", "concluded", "abandoned"]),
  conclusion: z.string().default(""),
});
export type Experiment = z.infer<typeof Experiment>;

export const ExperimentResult = BaseEntity.extend({
  experimentId: Id,
  variant: z.string(),
  metric: z.string(),
  value: z.number(),
  sampleSize: z.number().int().nonnegative(),
  periodStart: IsoDate,
  periodEnd: IsoDate,
});
export type ExperimentResult = z.infer<typeof ExperimentResult>;

export const DailyMemory = BaseEntity.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string(),
  wins: z.array(z.string()).default([]),
  failures: z.array(z.string()).default([]),
  bottlenecks: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  metrics: z.record(z.number()).default({}),
  whatChangedAndWhy: z.array(z.string()).default([]),
});
export type DailyMemory = z.infer<typeof DailyMemory>;

export const DurableLesson = BaseEntity.extend({
  topic: z.enum(["outreach", "auditing", "templates", "pricing", "process", "integration", "other"]),
  lesson: z.string(),
  evidence: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  timesConfirmed: z.number().int().default(1),
  supersededBy: Id.nullable().default(null),
});
export type DurableLesson = z.infer<typeof DurableLesson>;

export const OwnerRequest = BaseEntity.extend({
  title: z.string(),
  whyItMatters: z.string(),
  neededFields: z.array(z.string()),
  credentialKind: z.enum(["sandbox", "live", "either", "none"]),
  unblocks: z.array(z.string()),
  status: z.enum(["open", "in_progress", "fulfilled", "dismissed"]),
  category: z.enum([
    "credentials",
    "subscription",
    "account_setup",
    "decision",
    "content",
    "approval_policy",
    "other",
  ]),
  resolvedNote: z.string().default(""),
});
export type OwnerRequest = z.infer<typeof OwnerRequest>;
