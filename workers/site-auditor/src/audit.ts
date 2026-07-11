import {
  newId,
  nowIso,
  type Lead,
  type Logger,
  type PolicyTicket,
  type WebsiteAudit,
} from "@william/core";
import { launchChromium, type ChromiumLauncher } from "./browser";
import { deriveFindings, extractSignals } from "./heuristics";
import { playwrightAudit, type LighthouseRunner } from "./playwright-audit";

export type AuditorMode = "mock" | "http" | "playwright";

export interface AuditorDeps {
  mode: AuditorMode;
  log: Logger;
  /** Operational ticket authorizing outbound HTTP (crawl is an external call). */
  ticket: PolicyTicket;
  fetchImpl?: typeof fetch;
  /** Root for screenshot output (playwright mode). Defaults to ./data. */
  dataDir?: string;
  /** Injectable for tests; defaults to real Playwright Chromium detection. */
  launchBrowser?: ChromiumLauncher;
  lighthouseRunner?: LighthouseRunner;
  /** Defer the Lighthouse run out of the audit (see PlaywrightAuditDeps.skipLighthouse). */
  skipLighthouse?: boolean;
}

/**
 * Audits a lead's website. Modes:
 * - mock: fully synthesized from lead metadata (demo/local default)
 * - http: real fetch of robots.txt + homepage, heuristic extraction (no browser)
 * - playwright: screenshots + Lighthouse + axe via real Chromium; requires
 *   `npx playwright install chromium`. Falls back to http when unavailable.
 */
export async function auditWebsite(lead: Lead, deps: AuditorDeps): Promise<WebsiteAudit> {
  const base: Omit<WebsiteAudit, "summary" | "auditScore" | "visualAssessment"> = {
    id: newId("waud"),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    leadId: lead.id,
    url: lead.websiteUrl,
    mode: deps.mode,
    robotsAllowed: null,
    hasWebsite: !!lead.websiteUrl,
    hasSsl: null,
    mobileFriendly: null,
    pages: [],
    lighthouse: null,
    a11yFindings: [],
    extracted: { contactEmails: [], phones: [], socialLinks: {}, ctas: [], services: [], trustSignals: [] },
    weaknesses: [],
    outreachAngles: [],
    completedAt: nowIso(),
  };

  if (!lead.websiteUrl) {
    return {
      ...base,
      summary: "No website found for this business — a complete build opportunity.",
      auditScore: 0,
      outreachAngles: ["you don't have a website yet"],
      visualAssessment: null,
    };
  }

  if (deps.mode === "mock") return mockAudit(lead, base);

  if (deps.mode === "playwright") {
    // Compliance: robots.txt check happens BEFORE any browser launch.
    const robotsAllowed = await checkRobots(new URL(lead.websiteUrl).origin, deps.fetchImpl ?? fetch);
    if (!robotsAllowed) {
      deps.log.warn("robots.txt disallows crawling; aborting audit", { leadId: lead.id });
      return robotsAbortedAudit(base);
    }
    const result = await playwrightAudit(lead, base, {
      log: deps.log,
      dataDir: deps.dataDir ?? "./data",
      launchBrowser: deps.launchBrowser ?? launchChromium,
      lighthouseRunner: deps.lighthouseRunner,
      skipLighthouse: deps.skipLighthouse,
    });
    if (result) return result;
    deps.log.warn("Playwright mode unavailable — falling back to http audit", { leadId: lead.id });
    return httpAudit(lead, { ...base, mode: "http" }, deps);
  }

  return httpAudit(lead, base, deps);
}

/** robots.txt check shared by http and playwright modes. Unreachable = allowed (standard convention). */
export async function checkRobots(origin: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return !robotsDisallowsRoot(await res.text());
  } catch {
    // Unreachable robots.txt is treated as allowed.
  }
  return true;
}

function robotsAbortedAudit(base: Omit<WebsiteAudit, "summary" | "auditScore" | "visualAssessment">): WebsiteAudit {
  return {
    ...base,
    robotsAllowed: false,
    summary: "robots.txt disallows crawling — audit aborted out of respect for the site's policy.",
    auditScore: 50,
    visualAssessment: null,
  };
}

function mockAudit(lead: Lead, base: Omit<WebsiteAudit, "summary" | "auditScore" | "visualAssessment">): WebsiteAudit {
  // Deterministic per-domain pseudo-randomness so demo data is stable.
  const seed = [...(lead.domain ?? "x")].reduce((a, c) => a + c.charCodeAt(0), 0);
  const bad = seed % 3; // 0 = rough site, 1 = mediocre, 2 = decent
  const weaknesses: WebsiteAudit["weaknesses"] =
    bad === 0
      ? [
          { category: "mobile", detail: "Layout breaks below 480px; text overlaps.", severity: "high" },
          { category: "performance", detail: "Homepage ~6s load on simulated 4G.", severity: "high" },
          { category: "conversion", detail: "No booking or contact CTA above the fold.", severity: "high" },
          { category: "design", detail: "Last visual refresh appears pre-2015.", severity: "medium" },
        ]
      : bad === 1
        ? [
            { category: "seo", detail: "Missing meta description and h1 hierarchy.", severity: "medium" },
            { category: "trust", detail: "No reviews or testimonials shown.", severity: "medium" },
            { category: "conversion", detail: "Contact info buried on a subpage.", severity: "medium" },
          ]
        : [{ category: "content", detail: "Hours listed are inconsistent between pages.", severity: "low" }];
  const lighthouse =
    bad === 0
      ? { performance: 31, accessibility: 58, bestPractices: 65, seo: 49 }
      : bad === 1
        ? { performance: 62, accessibility: 74, bestPractices: 80, seo: 68 }
        : { performance: 88, accessibility: 91, bestPractices: 92, seo: 86 };
  const audit: WebsiteAudit = {
    ...base,
    robotsAllowed: true,
    hasSsl: bad !== 0,
    mobileFriendly: bad !== 0,
    lighthouse,
    pages: [
      { url: lead.websiteUrl!, title: `${lead.domain} — Home`, screenshotPath: null, mobileScreenshotPath: null, loadMs: bad === 0 ? 6100 : 2100, issues: [] },
    ],
    extracted: {
      contactEmails: bad < 2 ? [`info@${lead.domain}`] : [],
      phones: ["+1-607-555-0100"],
      socialLinks: bad < 2 ? { instagram: `https://instagram.com/${(lead.domain ?? "biz").split(".")[0]}` } : {},
      ctas: bad === 0 ? [] : ["contact us"],
      services: [],
      trustSignals: bad === 2 ? ["google reviews"] : [],
    },
    weaknesses,
    outreachAngles:
      bad === 0
        ? ["it's hard to use on a phone", "your homepage takes ~6 seconds to load", "there is no way to book online"]
        : bad === 1
          ? ["your business barely shows up in Google results", "visitors can't find your contact info quickly"]
          : ["a small refresh could lift conversions"],
    summary:
      bad === 0
        ? "[MOCK AUDIT] Site has severe mobile, speed, and conversion problems — strong rebuild candidate."
        : bad === 1
          ? "[MOCK AUDIT] Functional but dated site with SEO and trust gaps — good improvement pitch."
          : "[MOCK AUDIT] Solid site; only minor polish opportunities.",
    auditScore: bad === 0 ? 25 : bad === 1 ? 55 : 85,
    visualAssessment: null,
  };
  return audit;
}

async function httpAudit(
  lead: Lead,
  base: Omit<WebsiteAudit, "summary" | "auditScore" | "visualAssessment">,
  deps: AuditorDeps,
): Promise<WebsiteAudit> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = lead.websiteUrl!;
  const origin = new URL(url).origin;

  // Compliance: check robots.txt before any crawling.
  const robotsAllowed = await checkRobots(origin, fetchImpl);
  if (!robotsAllowed) {
    deps.log.warn("robots.txt disallows crawling; aborting audit", { leadId: lead.id });
    return robotsAbortedAudit(base);
  }

  const started = Date.now();
  let html = "";
  let finalUrl = url;
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    finalUrl = res.url || url;
    html = await res.text();
  } catch (err) {
    return {
      ...base,
      robotsAllowed: true,
      hasWebsite: false,
      summary: `Website unreachable (${err instanceof Error ? err.message : "fetch failed"}) — treat as no-website lead.`,
      auditScore: 5,
      outreachAngles: ["your listed website doesn't load at all"], // fine after "noticed"
      visualAssessment: null,
    };
  }
  const loadMs = Date.now() - started;
  const signals = extractSignals({ html, url: finalUrl, loadMs });
  const { weaknesses, outreachAngles, auditScore } = deriveFindings(signals, loadMs);

  return {
    ...base,
    robotsAllowed: true,
    hasSsl: finalUrl.startsWith("https://"),
    mobileFriendly: signals.hasViewportMeta,
    pages: [{ url: finalUrl, title: signals.title, screenshotPath: null, mobileScreenshotPath: null, loadMs, issues: [] }],
    extracted: {
      contactEmails: signals.contactEmails,
      phones: signals.phones,
      socialLinks: signals.socialLinks,
      ctas: signals.ctas,
      services: signals.services,
      trustSignals: signals.trustSignals,
    },
    weaknesses,
    outreachAngles,
    summary: `HTTP audit of ${finalUrl}: ${weaknesses.length} weakness(es) found; ${signals.ctas.length} CTA(s); ${signals.contactEmails.length} published email(s).`,
    auditScore,
    visualAssessment: null,
  };
}

/** Minimal robots.txt check: does any User-agent: * block disallow "/"? */
export function robotsDisallowsRoot(robots: string): boolean {
  let inStar = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(":");
    const key = keyRaw!.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") inStar = value === "*";
    else if (inStar && key === "disallow" && (value === "/" || value === "/*")) return true;
  }
  return false;
}
