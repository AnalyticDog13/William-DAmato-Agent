import { z } from "zod";
import { BaseEntity, Confidence, Id, IsoDate, Niche, SourceProvenance } from "./common";

export const LeadStatus = z.enum([
  "new",
  "auditing",
  "audited",
  "scored",
  "contact_ready",
  "draft_ready",
  "approved_for_send",
  "contacted",
  "replied",
  "opportunity",
  "customer",
  // Said no, or 14+ days of silence after the final touch. No further outreach.
  "not_interested",
  "disqualified",
  "do_not_contact",
]);
export type LeadStatus = z.infer<typeof LeadStatus>;

export const Lead = BaseEntity.extend({
  companyId: Id,
  domain: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  niche: Niche,
  status: LeadStatus,
  source: SourceProvenance,
  /** Identity keys used for dedupe (domain:…, email:…, company:…). */
  identityKeys: z.array(z.string()),
  notes: z.string().default(""),
  disqualifiedReason: z.string().nullable().default(null),
});
export type Lead = z.infer<typeof Lead>;

export const Company = BaseEntity.extend({
  name: z.string(),
  identityKey: z.string(),
  niche: Niche,
  city: z.string().nullable(),
  region: z.string().nullable(),
  country: z.string().nullable().default("US"),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  socialLinks: z.record(z.string()).default({}),
  description: z.string().default(""),
});
export type Company = z.infer<typeof Company>;

export const ContactVerification = z.enum(["unverified", "verifying", "valid", "risky", "invalid"]);

export const Contact = BaseEntity.extend({
  leadId: Id,
  companyId: Id,
  name: z.string().nullable(),
  role: z.string().nullable(),
  email: z.string().nullable(),
  emailSource: z.enum(["website_published", "enrichment", "owner_provided", "reply"]).nullable(),
  emailProvider: z.string().nullable().default(null),
  verification: ContactVerification.default("unverified"),
  confidence: Confidence.default(0),
  phone: z.string().nullable().default(null),
});
export type Contact = z.infer<typeof Contact>;

export const LeadScoreTier = z.enum(["hot", "warm", "cold", "skip"]);
export type LeadScoreTier = z.infer<typeof LeadScoreTier>;

export const LeadScore = BaseEntity.extend({
  leadId: Id,
  auditId: Id.nullable(),
  score: z.number().min(0).max(100),
  tier: LeadScoreTier,
  reasons: z.array(z.string()),
  scoredAt: IsoDate,
});
export type LeadScore = z.infer<typeof LeadScore>;
