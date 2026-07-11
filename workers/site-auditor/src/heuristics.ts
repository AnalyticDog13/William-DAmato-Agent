import { extractEmails, type WebsiteAudit, type WebsiteWeakness } from "@william/core";

export interface PageSignals {
  html: string;
  url: string;
  loadMs: number | null;
}

export interface ExtractedSignals {
  title: string | null;
  contactEmails: string[];
  phones: string[];
  socialLinks: Record<string, string>;
  ctas: string[];
  services: string[];
  trustSignals: string[];
  hasViewportMeta: boolean;
  hasTitleAndDescription: boolean;
  imageCount: number;
  imagesMissingAlt: number;
  usesHttps: boolean;
}

const SOCIAL_HOSTS: Record<string, RegExp> = {
  instagram: /instagram\.com\/[\w.\-/]+/i,
  facebook: /facebook\.com\/[\w.\-/]+/i,
  tiktok: /tiktok\.com\/@?[\w.\-/]+/i,
  yelp: /yelp\.com\/biz\/[\w.\-/]+/i,
  linkedin: /linkedin\.com\/(company|in)\/[\w.\-/]+/i,
};

const CTA_PATTERNS = /\b(book now|book online|order online|reserve|schedule|get a quote|contact us|call now|sign up|shop now)\b/gi;
const TRUST_PATTERNS = /\b(testimonial|review|google reviews|5-star|five star|award|certified|since \d{4}|family owned)\b/gi;

/** Extracts structured signals from raw page HTML — regex heuristics, no DOM. */
export function extractSignals(page: PageSignals): ExtractedSignals {
  const html = page.html;
  const emails = extractEmails(html);
  const phones = [...new Set(html.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g) ?? [])].slice(0, 3);
  const socialLinks: Record<string, string> = {};
  for (const [name, re] of Object.entries(SOCIAL_HOSTS)) {
    const m = html.match(re);
    if (m) socialLinks[name] = `https://${m[0].replace(/^https?:\/\//, "")}`;
  }
  const ctas = [...new Set((html.match(CTA_PATTERNS) ?? []).map((c) => c.toLowerCase()))];
  const trustSignals = [...new Set((html.match(TRUST_PATTERNS) ?? []).map((t) => t.toLowerCase()))];
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const imagesMissingAlt = imgTags.filter((t) => !/\salt\s*=\s*["'][^"']+["']/i.test(t)).length;
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);

  return {
    title: titleMatch?.[1]?.trim() || null,
    contactEmails: emails.slice(0, 5),
    phones,
    socialLinks,
    ctas,
    services: extractServices(html),
    trustSignals,
    hasViewportMeta: /<meta[^>]+name=["']viewport["']/i.test(html),
    hasTitleAndDescription: !!titleMatch && /<meta[^>]+name=["']description["']/i.test(html),
    imageCount: imgTags.length,
    imagesMissingAlt,
    usesHttps: page.url.startsWith("https://"),
  };
}

function extractServices(html: string): string[] {
  // Headings often name services/menu items; crude but useful for personalization.
  const headings = [...html.matchAll(/<h[23][^>]*>([^<]{3,60})<\/h[23]>/gi)].map((m) =>
    m[1]!.replace(/\s+/g, " ").trim(),
  );
  return [...new Set(headings)].slice(0, 8);
}

/** Derives weaknesses + outreach angles from extracted signals. */
export function deriveFindings(signals: ExtractedSignals, loadMs: number | null): {
  weaknesses: WebsiteWeakness[];
  outreachAngles: string[];
  auditScore: number;
} {
  const weaknesses: WebsiteWeakness[] = [];
  const angles: string[] = [];

  if (!signals.usesHttps) {
    weaknesses.push({ category: "technical", detail: "Site served over HTTP — browsers flag it 'Not secure'.", severity: "high" });
    angles.push("it shows a 'Not secure' warning to every visitor");
  }
  if (!signals.hasViewportMeta) {
    weaknesses.push({ category: "mobile", detail: "No viewport meta tag — page is not mobile-optimized.", severity: "high" });
    angles.push("it doesn't adapt to phones, where most of your customers are searching");
  }
  if (!signals.hasTitleAndDescription) {
    weaknesses.push({ category: "seo", detail: "Missing title/meta description — weak search appearance.", severity: "medium" });
    angles.push("Google shows incomplete info for your business");
  }
  if (signals.ctas.length === 0) {
    weaknesses.push({ category: "conversion", detail: "No clear call-to-action (book/order/contact).", severity: "high" });
    angles.push("there's no obvious next step for visitors, with no booking or contact button");
  }
  if (signals.trustSignals.length === 0) {
    weaknesses.push({ category: "trust", detail: "No reviews/testimonials/credentials visible.", severity: "medium" });
  }
  if (signals.imageCount > 0 && signals.imagesMissingAlt / signals.imageCount > 0.5) {
    weaknesses.push({ category: "accessibility", detail: `${signals.imagesMissingAlt}/${signals.imageCount} images missing alt text.`, severity: "low" });
  }
  // Load timing is recorded as an INTERNAL weakness only — the raw `load` event
  // overstates perceived speed (it waits on every third-party pixel, lazy image,
  // chat widget, etc.), so a site that paints fast can show a slow `load`. We do
  // NOT turn it into a customer-facing outreach claim here. The "slow site"
  // outreach angle is added later, ONLY when Lighthouse confirms it
  // (see `lighthouseSlowAngle` + handleScore) — never from this number alone.
  if (loadMs != null && loadMs > 6000) {
    weaknesses.push({ category: "performance", detail: `Homepage 'load' event took ${(loadMs / 1000).toFixed(1)}s (full resource load; not necessarily perceived speed).`, severity: "medium" });
  }

  // Audit score reflects how GOOD the site is (100 = excellent).
  let score = 100;
  for (const w of weaknesses) score -= w.severity === "high" ? 18 : w.severity === "medium" ? 10 : 4;
  return { weaknesses, outreachAngles: angles.slice(0, 4), auditScore: Math.max(0, score) };
}

/**
 * Lighthouse performance score below which we are willing to TELL a prospect
 * their site is slow. Lighthouse runs a throttled mobile profile, so this is a
 * defensible, real-world "slow" — unlike the raw `load`-event time. < 50 is
 * Lighthouse's own "poor" (red) band.
 */
export const SLOW_PERFORMANCE_SCORE = 50;

/**
 * The truthful, plain-language "slow site" outreach angle — but ONLY when
 * Lighthouse confirms the site is genuinely slow. Returns null otherwise, so we
 * never claim a fast-painting site is slow just because its `load` event was
 * long. Plain wording (no jargon) per the outreach style rules.
 */
export function lighthouseSlowAngle(lighthouse: WebsiteAudit["lighthouse"]): string | null {
  const perf = lighthouse?.performance;
  if (perf == null || perf >= SLOW_PERFORMANCE_SCORE) return null;
  return "it's slow to load on a typical phone, which can lose impatient visitors";
}
