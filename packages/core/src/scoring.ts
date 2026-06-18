import type { WebsiteAudit } from "./schema/audit";
import type { LeadScoreTier } from "./schema/lead";

export interface ScoreResult {
  score: number;
  tier: LeadScoreTier;
  reasons: string[];
}

/**
 * Scores how worth contacting a lead is, from its website audit.
 * Higher = more opportunity for us (worse/missing site, reachable business).
 * Deterministic and explainable: every point movement adds a reason.
 */
export function scoreLead(audit: WebsiteAudit): ScoreResult {
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

  // Reachability: a great prospect we cannot contact is not a prospect.
  const reachable = audit.extracted.contactEmails.length > 0 || audit.extracted.phones.length > 0;
  if (reachable) add(10, "Published contact info found — reachable via business-published channels.");
  else add(-10, "No published contact info — needs enrichment before outreach.");


  score = Math.max(0, Math.min(100, score));
  const tier: LeadScoreTier = score >= 65 ? "hot" : score >= 40 ? "warm" : score >= 20 ? "cold" : "skip";
  return { score, tier, reasons };
}
