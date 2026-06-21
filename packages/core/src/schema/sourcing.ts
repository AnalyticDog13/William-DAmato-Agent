import { z } from "zod";
import { BaseEntity, Id, Niche } from "./common";

export const SourcingRunStatus = z.enum([
  "pending_approval", "running", "completed", "stopped_cap", "stopped_exhausted", "failed",
]);
export type SourcingRunStatus = z.infer<typeof SourcingRunStatus>;

export const SourcingRun = BaseEntity.extend({
  location: z.string(),
  niche: Niche,
  target: z.number().int().positive(),
  candidateCap: z.number().int().positive(),
  status: SourcingRunStatus,
  candidatesIngested: z.number().int().min(0).default(0),
  qualifiedCount: z.number().int().min(0).default(0),
  leadIds: z.array(Id).default([]),
  nextPageToken: z.string().nullable().default(null),
  checks: z.number().int().min(0).default(0),
  approvalRequestId: Id.nullable().default(null),
  resultNote: z.string().nullable().default(null),
  traceId: z.string(),
});
export type SourcingRun = z.infer<typeof SourcingRun>;
