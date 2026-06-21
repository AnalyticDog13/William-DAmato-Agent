import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Lead, Logger, WebsiteAudit } from "@william/core";
import { freePort, launchChromium, type ChromiumLauncher, type MinimalPage } from "./browser";
import { deriveFindings, extractSignals } from "./heuristics";

export type LighthouseRunner = (url: string, port: number, log: Logger) => Promise<WebsiteAudit["lighthouse"]>;

export interface PlaywrightAuditDeps {
  log: Logger;
  dataDir: string;
  launchBrowser: ChromiumLauncher;
  lighthouseRunner?: LighthouseRunner;
  /**
   * Skip the (expensive) Lighthouse run during the audit. The orchestrator sets
   * this so Lighthouse is DEFERRED to the score step, which only runs for leads
   * that resolved a contactable email — no point paying for Lighthouse on a lead
   * we can't email. When true, `lighthouse` is left null; run it later via
   * `runDeferredLighthouse`.
   */
  skipLighthouse?: boolean;
}

const DESKTOP_VIEWPORT = { width: 1366, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * Browser-grade audit: real Chromium render, desktop+mobile screenshots,
 * Lighthouse scores, axe-core accessibility scan. Returns null on any
 * browser-level failure so the caller can fall back to http mode.
 * Caller is responsible for the robots.txt check (done before launch).
 */
export async function playwrightAudit(
  lead: Lead,
  base: Omit<WebsiteAudit, "summary" | "auditScore" | "visualAssessment">,
  deps: PlaywrightAuditDeps,
): Promise<WebsiteAudit | null> {
  const url = lead.websiteUrl!;
  const cdpPort = await freePort();
  const browser = await deps.launchBrowser(deps.log, { args: [`--remote-debugging-port=${cdpPort}`] });
  if (!browser) return null;
  try {
    const page = await browser.newPage({ viewport: DESKTOP_VIEWPORT });
    const started = Date.now();
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    const loadMs = Date.now() - started;
    // Let lazy-loaded / slow / JS-injected imagery settle BEFORE we screenshot
    // and read content, so the capture + extracted signals reflect what a real
    // visitor sees (avoids a false "no hero image" when it loads a few seconds
    // late). Bounded so a site with persistent connections can't hang the audit.
    // `loadMs` is already measured off the load event, so the "slow load"
    // finding stays based on real load time, not this settle wait.
    try {
      await page.waitForLoadState?.("networkidle", { timeout: 8_000 });
    } catch {
      /* networkidle never reached (persistent connection) — proceed with what's painted */
    }
    await page.waitForTimeout?.(800); // final settle for fade-in / late paint
    const title = await page.title();
    const html = await page.content();
    const finalUrl = page.url() || url;

    const shotDir = join(deps.dataDir, "screenshots", lead.id);
    mkdirSync(shotDir, { recursive: true });
    const screenshotPath = join(shotDir, "home-desktop.png");
    const mobileScreenshotPath = join(shotDir, "home-mobile.png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.screenshot({ path: mobileScreenshotPath, fullPage: false });

    const a11yFindings = await runAxe(page, deps.log);
    const lighthouse = deps.skipLighthouse
      ? null
      : await (deps.lighthouseRunner ?? runLighthouse)(finalUrl, cdpPort, deps.log);

    const signals = extractSignals({ html, url: finalUrl, loadMs });
    const { weaknesses, outreachAngles, auditScore } = deriveFindings(signals, loadMs);
    if (a11yFindings.length > 0) {
      weaknesses.push({
        category: "accessibility",
        detail: `axe-core: ${a11yFindings.length} violation type(s) on the homepage.`,
        severity: a11yFindings.length > 5 ? "medium" : "low",
      });
    }

    return {
      ...base,
      mode: "playwright",
      robotsAllowed: true,
      hasSsl: finalUrl.startsWith("https://"),
      mobileFriendly: signals.hasViewportMeta,
      pages: [{ url: finalUrl, title: title || signals.title, screenshotPath, mobileScreenshotPath, loadMs, issues: [] }],
      lighthouse,
      a11yFindings,
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
      summary: `Browser audit of ${finalUrl}: ${weaknesses.length} weakness(es); Lighthouse perf ${lighthouse?.performance ?? "n/a"}; ${a11yFindings.length} a11y violation type(s).`,
      auditScore,
      visualAssessment: null,
    };
  } catch (err) {
    deps.log.warn("Playwright audit failed; caller will fall back to http mode", {
      leadId: lead.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Injects axe-core into the page and returns violation summaries. */
async function runAxe(page: MinimalPage, log: Logger): Promise<string[]> {
  try {
    const require = createRequire(import.meta.url);
    const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate<{
      violations: { id: string; impact?: string | null; help: string; nodes: unknown[] }[];
    }>(() => (globalThis as { axe?: { run(): unknown } }).axe!.run());
    return results.violations.map((v) => `${v.id} (${v.impact ?? "n/a"}): ${v.help} — ${v.nodes.length} element(s)`);
  } catch (err) {
    log.warn("axe-core scan failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** Runs Lighthouse against the already-launched Chromium via its CDP port. */
export const runLighthouse: LighthouseRunner = async (url, port, log) => {
  try {
    const lighthouse = (await import("lighthouse")).default as (
      url: string,
      flags: Record<string, unknown>,
    ) => Promise<{ lhr?: { categories?: Record<string, { score?: number | null }> } } | undefined>;
    const result = await lighthouse(url, {
      port,
      output: "json",
      logLevel: "silent",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    });
    const cats = result?.lhr?.categories;
    if (!cats) return null;
    const pct = (c?: { score?: number | null }) => (typeof c?.score === "number" ? Math.round(c.score * 100) : null);
    return {
      performance: pct(cats.performance),
      accessibility: pct(cats.accessibility),
      bestPractices: pct(cats["best-practices"]),
      seo: pct(cats.seo),
    };
  } catch (err) {
    log.warn("Lighthouse run failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
};

/**
 * Runs Lighthouse against a live URL on its own short-lived Chromium — used to
 * DEFER the audit's Lighthouse run until after a contactable email is resolved
 * (so un-emailable leads never incur it). Launches Chromium with a CDP port and
 * points Lighthouse at it (Lighthouse drives its own navigation, exactly as in
 * the inline audit). Returns null when no browser is available or on failure, so
 * the caller scores deterministically — never throws, never blocks the pipeline.
 * The caller is responsible for the robots.txt check (the audit already did it).
 */
export async function runDeferredLighthouse(
  url: string,
  deps: { log: Logger; launchBrowser: ChromiumLauncher; lighthouseRunner?: LighthouseRunner },
): Promise<WebsiteAudit["lighthouse"]> {
  const cdpPort = await freePort();
  const browser = await deps.launchBrowser(deps.log, { args: [`--remote-debugging-port=${cdpPort}`] });
  if (!browser) return null;
  try {
    return await (deps.lighthouseRunner ?? runLighthouse)(url, cdpPort, deps.log);
  } catch (err) {
    deps.log.warn("Deferred Lighthouse run failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Fallback when no config is provided; runtime values come from RuntimeConfig.previewQuality. */
export const PREVIEW_QUALITY_THRESHOLDS = {
  minPerformance: 70,
  minAccessibility: 80,
};

export interface PreviewQualityResult {
  lighthousePassed: boolean | null;
  a11yPassed: boolean | null;
  notes: string[];
  screenshotPaths: string[];
}

/**
 * Quality-checks a GENERATED preview (site-builder output) before owner review:
 * serves the HTML over an ephemeral localhost server (Lighthouse can't audit
 * file:// URLs), screenshots desktop+mobile, runs Lighthouse + axe-core.
 * Returns null when no browser is available — the check is skipped, not failed.
 */
export async function qualityCheckPreview(opts: {
  previewPath: string;
  outDir: string;
  log: Logger;
  launchBrowser?: ChromiumLauncher;
  lighthouseRunner?: LighthouseRunner;
  thresholds?: { minPerformance: number; minAccessibility: number };
}): Promise<PreviewQualityResult | null> {
  const thresholds = opts.thresholds ?? PREVIEW_QUALITY_THRESHOLDS;
  const html = readFileSync(opts.previewPath, "utf8");
  const serverPort = await freePort();
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(html);
  });
  await new Promise<void>((ready) => server.listen(serverPort, "127.0.0.1", ready));
  const cdpPort = await freePort();
  const browser = await (opts.launchBrowser ?? launchChromium)(opts.log, {
    args: [`--remote-debugging-port=${cdpPort}`],
  });
  if (!browser) {
    server.close();
    return null;
  }
  const url = `http://127.0.0.1:${serverPort}/`;
  try {
    const page = await browser.newPage({ viewport: DESKTOP_VIEWPORT });
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    mkdirSync(opts.outDir, { recursive: true });
    const desktopPath = join(opts.outDir, "preview-desktop.png");
    const mobilePath = join(opts.outDir, "preview-mobile.png");
    await page.screenshot({ path: desktopPath, fullPage: true });
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.screenshot({ path: mobilePath, fullPage: true });

    const a11yFindings = await runAxe(page, opts.log);
    const lighthouse = await (opts.lighthouseRunner ?? runLighthouse)(url, cdpPort, opts.log);

    const notes: string[] = [];
    let lighthousePassed: boolean | null = null;
    if (lighthouse && lighthouse.performance != null && lighthouse.accessibility != null) {
      lighthousePassed =
        lighthouse.performance >= thresholds.minPerformance &&
        lighthouse.accessibility >= thresholds.minAccessibility;
      notes.push(
        `Lighthouse: perf ${lighthouse.performance}, a11y ${lighthouse.accessibility}, bp ${lighthouse.bestPractices ?? "n/a"}, seo ${lighthouse.seo ?? "n/a"}.`,
      );
    } else {
      notes.push("Lighthouse unavailable for preview check.");
    }
    const a11yPassed = a11yFindings.length === 0;
    if (!a11yPassed) notes.push(`axe-core violations: ${a11yFindings.slice(0, 5).join("; ")}`);

    return { lighthousePassed, a11yPassed, notes, screenshotPaths: [desktopPath, mobilePath] };
  } catch (err) {
    opts.log.warn("Preview quality check failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}
