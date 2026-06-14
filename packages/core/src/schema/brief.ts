import { z } from "zod";
import { BaseEntity, Id } from "./common";

/**
 * Real, scraped facts about the lead's business — gathered by the Firecrawl
 * adapter (mock synthesizes them from the existing audit). These feed the build
 * prompt so the owner's site uses the company's real services/hours/photos.
 * NOTE: every field here is DATA quoted into the build prompt, never instructions
 * (invariant 1).
 */
export const CompanyFacts = z.object({
  services: z.array(z.string()).default([]),
  hours: z.string().nullable().default(null),
  photos: z.array(z.string()).default([]),
  about: z.string().default(""),
  contact: z
    .object({
      email: z.string().nullable().default(null),
      phone: z.string().nullable().default(null),
      address: z.string().nullable().default(null),
    })
    .default({}),
});
export type CompanyFacts = z.infer<typeof CompanyFacts>;

export const WebsiteBriefStatus = z.enum(["ready", "shipped"]);
export type WebsiteBriefStatus = z.infer<typeof WebsiteBriefStatus>;

/**
 * A build prompt William generates on a positive reply, for the OWNER to run on
 * Fable 5 / Opus 4.8. William does not build the site himself (default config);
 * he produces this brief and later ships the owner's finished repo (site.ship).
 */
export const WebsiteBrief = BaseEntity.extend({
  leadId: Id,
  opportunityId: Id.nullable().default(null),
  /** The lead's current site (the one being replaced). */
  websiteUrl: z.string().nullable().default(null),
  /** Audit weaknesses the new site must fix. */
  weaknesses: z.array(z.string()).default([]),
  companyFacts: CompanyFacts,
  /** The full generated build prompt the owner pastes into Fable/Opus. */
  buildPrompt: z.string(),
  recommendedStack: z.object({
    libs: z.array(z.string()).default([]),
    plugins: z.array(z.string()).default([]),
  }),
  /** Recommended build model — defaults to Fable 5 for design quality. */
  targetModel: z.enum(["fable-5", "opus-4-8"]).default("fable-5"),
  /** How the prompt was produced: deterministic mock template, or a real LLM. */
  generatedBy: z.enum(["mock", "opus-4-8", "fable-5"]).default("mock"),
  /** Set when the owner marks the site ready (site.ship). */
  repoUrl: z.string().nullable().default(null),
  status: WebsiteBriefStatus.default("ready"),
});
export type WebsiteBrief = z.infer<typeof WebsiteBrief>;
