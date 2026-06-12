import { z } from "zod";
import { BaseEntity, Id, IsoDate } from "./common";

export const LighthouseScores = z.object({
  performance: z.number().min(0).max(100).nullable(),
  accessibility: z.number().min(0).max(100).nullable(),
  bestPractices: z.number().min(0).max(100).nullable(),
  seo: z.number().min(0).max(100).nullable(),
});

export const AuditedPage = z.object({
  url: z.string(),
  title: z.string().nullable(),
  screenshotPath: z.string().nullable(),
  mobileScreenshotPath: z.string().nullable().default(null),
  loadMs: z.number().nullable(),
  issues: z.array(z.string()).default([]),
});

export const WebsiteWeakness = z.object({
  category: z.enum([
    "performance",
    "mobile",
    "design",
    "content",
    "seo",
    "accessibility",
    "trust",
    "conversion",
    "technical",
  ]),
  detail: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});
export type WebsiteWeakness = z.infer<typeof WebsiteWeakness>;

export const WebsiteAudit = BaseEntity.extend({
  leadId: Id,
  url: z.string().nullable(),
  mode: z.enum(["mock", "http", "playwright"]),
  robotsAllowed: z.boolean().nullable(),
  hasWebsite: z.boolean(),
  hasSsl: z.boolean().nullable(),
  mobileFriendly: z.boolean().nullable(),
  pages: z.array(AuditedPage).default([]),
  lighthouse: LighthouseScores.nullable(),
  a11yFindings: z.array(z.string()).default([]),
  extracted: z.object({
    contactEmails: z.array(z.string()).default([]),
    phones: z.array(z.string()).default([]),
    socialLinks: z.record(z.string()).default({}),
    ctas: z.array(z.string()).default([]),
    services: z.array(z.string()).default([]),
    trustSignals: z.array(z.string()).default([]),
  }),
  weaknesses: z.array(WebsiteWeakness).default([]),
  outreachAngles: z.array(z.string()).default([]),
  summary: z.string(),
  auditScore: z.number().min(0).max(100),
  completedAt: IsoDate.nullable(),
});
export type WebsiteAudit = z.infer<typeof WebsiteAudit>;
