import { z } from "zod";

export const VisualFindingCategory = z.enum([
  "value_prop_unclear",
  "cta_missing_or_hidden",
  "color_clash",
  "visual_clutter",
  "dated_design",
  "poor_hierarchy",
  "weak_branding",
  "wholesale_promo_weak",
  "mobile_layout_broken",
  "low_trust_visual",
  "imagery_quality",
  "text_legibility",
  "navigation_confusing",
  "whitespace_imbalance",
  "other",
]);
export type VisualFindingCategory = z.infer<typeof VisualFindingCategory>;

export const VisualFinding = z.object({
  category: VisualFindingCategory,
  detail: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});
export type VisualFinding = z.infer<typeof VisualFinding>;

/**
 * Screenshot-derived visual verdict. `visualOpportunityScore` is in the SAME
 * direction as the deterministic lead score: higher = more visual problems =
 * better prospect for us. `weak` = messy/confusing (promote); `strong` =
 * clean/effective (demote). Produced by `llm.scoreVisualDesign`; null when no
 * screenshots / dry-run / mock.
 */
export const VisualAssessment = z.object({
  visualOpportunityScore: z.number().min(0).max(100),
  verdict: z.enum(["weak", "adequate", "strong"]),
  confidence: z.number().min(0).max(1),
  findings: z.array(VisualFinding).default([]),
  positives: z.array(z.string()).default([]),
  model: z.string(),
});
export type VisualAssessment = z.infer<typeof VisualAssessment>;
