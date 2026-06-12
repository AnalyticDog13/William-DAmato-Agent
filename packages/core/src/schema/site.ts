import { z } from "zod";
import { BaseEntity, Id, IsoDate, Niche } from "./common";

export const SiteProjectStatus = z.enum([
  "gathering_inputs",
  "building",
  "preview_ready",
  "owner_review",
  "revisions",
  "approved_for_customer",
  "deploying",
  "live",
  "abandoned",
]);

export const SiteProject = BaseEntity.extend({
  leadId: Id,
  opportunityId: Id.nullable(),
  templateId: z.string(),
  niche: Niche,
  status: SiteProjectStatus,
  previewUrl: z.string().nullable().default(null),
  previewPath: z.string().nullable().default(null),
  screenshotPaths: z.array(z.string()).default([]),
  rationale: z.string().default(""),
  companyData: z.record(z.unknown()).default({}),
  missingInputs: z.array(z.string()).default([]),
});
export type SiteProject = z.infer<typeof SiteProject>;

export const SiteRevision = BaseEntity.extend({
  siteProjectId: Id,
  requestedBy: z.enum(["owner", "lead"]),
  request: z.string(),
  status: z.enum(["pending", "applied", "rejected"]),
  resultNote: z.string().default(""),
});
export type SiteRevision = z.infer<typeof SiteRevision>;

export const DeploymentRecord = BaseEntity.extend({
  siteProjectId: Id,
  target: z.enum(["preview", "production"]),
  provider: z.literal("vercel"),
  status: z.enum(["pending", "dry_run", "deployed", "failed", "rolled_back"]),
  url: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  approvalRequestId: Id.nullable().default(null),
  qualityChecks: z
    .object({
      lighthousePassed: z.boolean().nullable(),
      a11yPassed: z.boolean().nullable(),
      notes: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
  rollbackOf: Id.nullable().default(null),
  errorLog: z.string().nullable().default(null),
  deployedAt: IsoDate.nullable().default(null),
});
export type DeploymentRecord = z.infer<typeof DeploymentRecord>;
