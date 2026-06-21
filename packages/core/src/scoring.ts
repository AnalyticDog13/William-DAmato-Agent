import type { WebsiteAudit } from "./schema/audit";
import type { VisualAssessment } from "./schema/visual";
import type { LeadScoreTier } from "./schema/lead";

export interface ScoreResult {
  score: number;
  tier: LeadScoreTier;
  reasons: string[];
}

/** Combine weights/floors for the visual layer (defaults; RuntimeConfig may override at the call site later). */
const VISUAL_DEFAULTS = { weight: 0.5, promoteMinConfidence: 0.7, demoteMinConfidence: 0.7 };
const WARM_FLOOR = 40; // tier threshold for "warm"
const SKIP_CEILING = 19; // just below "cold" (20)

/**
 * Scores how worth contacting a lead is, from its website audit.
 * Higher = more opportunity for us (worse/missing site, reachable business).
 * Deterministic and explainable: every point movement adds a reason.
 *
 * Optional second arg `visual` blends bidirectionally:
 *   - confident `weak` verdict floors the score into "warm" (promote)
 *   - confident `strong` verdict caps at skip (demote)
 * Passing null/omitting reproduces today's behavior exactly.
 */
export function scoreLead(
  audit: WebsiteAudit,
  visual?: VisualAssessment | null,
  visualConfig: { weight: number; promoteMinConfidence: number; demoteMinConfidence: number } = VISUAL_DEFAULTS,
  opts?: { reachableEmail?: boolean },
): ScoreResult {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(`${points > 0 ? "+" : ""}${points}: ${reason}`);
  };

  if (!audit.hasWebsite) {
    add(60, "No website at all — highest-value prospect for a new build.");
  } else {
    if (audit.hasSsl === false) add(10, "No SSL — site shows as 'Not secure'.");
    if (audit.mobileFriendly === false) add(15, "Not mobile friendly.");
    const perf = audit.lighthouse?.performance;
    if (perf != null && perf < 40) add(15, `Very slow site (Lighthouse performance ${perf}).`);
    else if (perf != null && perf < 70) add(8, `Slow site (Lighthouse performance ${perf}).`);
    const seo = audit.lighthouse?.seo;
    if (seo != null && seo < 60) add(8, `Weak SEO basics (Lighthouse SEO ${seo}).`);
    const a11y = audit.lighthouse?.accessibility;
    if (a11y != null && a11y < 60) add(5, `Accessibility problems (score ${a11y}).`);

    for (const w of audit.weaknesses) {
      const pts = w.severity === "high" ? 6 : w.severity === "medium" ? 3 : 1;
      add(pts, `${w.category}: ${w.detail}`);
    }
    if (audit.extracted.ctas.length === 0) add(8, "No clear call-to-action found.");
    if (audit.extracted.trustSignals.length === 0) add(4, "No trust signals (reviews, testimonials).");
  }

  // Reachability: outreach is email-only. Prefer the RESOLVED contact (which
  // reflects the homepage pass AND the Playwright crawl) over HTML-only emails,
  // so a lead whose email was found by the crawl is not wrongly penalized.
  // Falls back to the audit's HTML emails when the caller doesn't pass a result.
  const reachable = opts?.reachableEmail ?? audit.extracted.contactEmails.length > 0;
  if (reachable) add(10, "Contact email found — reachable for email outreach.");
  else add(-10, "No email found — needs discovery/enrichment before outreach.");

  let deterministic = Math.max(0, Math.min(100, score));
  let final = deterministic;

  if (visual) {
    const v = visual.visualOpportunityScore;
    const w = visualConfig.weight;
    final = Math.round((1 - w) * deterministic + w * v);
    for (const f of visual.findings) {
      reasons.push(`visual ${f.severity} (${f.category}): ${f.detail}`);
    }
    if (visual.verdict === "weak" && visual.confidence >= visualConfig.promoteMinConfidence && final < WARM_FLOOR) {
      reasons.push(`visual promote: site looks weak/confusing (conf ${visual.confidence.toFixed(2)}) — floored to warm`);
      final = WARM_FLOOR;
    }
    if (visual.verdict === "strong" && visual.confidence >= visualConfig.demoteMinConfidence && final > SKIP_CEILING) {
      reasons.push(`visual demote: site looks clean/effective (conf ${visual.confidence.toFixed(2)}) — capped to skip`);
      final = SKIP_CEILING;
    }
    final = Math.max(0, Math.min(100, final));
  }

  const tier: LeadScoreTier = final >= 65 ? "hot" : final >= 40 ? "warm" : final >= 20 ? "cold" : "skip";
  return { score: final, tier, reasons };
}
