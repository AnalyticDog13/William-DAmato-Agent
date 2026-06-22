import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger, nowIso, type Lead, type PolicyTicket } from "@william/core";
import { auditWebsite } from "../src/audit";
import { lighthouseSlowAngle } from "../src/heuristics";
import { qualityCheckPreview } from "../src/playwright-audit";
import type { MinimalBrowser, MinimalPage } from "../src/browser";

const log = createLogger({ app: "test" }, () => {});
const ticket = { id: "tkt_test" } as unknown as PolicyTicket;

const lead: Lead = {
  id: "lead_test1",
  createdAt: nowIso(),
  updatedAt: nowIso(),
  companyId: "com_test1",
  domain: "fake-biz.example.com",
  websiteUrl: "https://fake-biz.example.com",
  niche: "barbershop",
  status: "auditing",
  source: { kind: "manual", detail: "test", importedAt: nowIso(), importedBy: "owner" },
  identityKeys: ["domain:fake-biz.example.com"],
  notes: "",
  disqualifiedReason: null,
};

const PAGE_HTML =
  "<html><head><title>Fake Biz</title></head><body><h2>Haircuts</h2><p>contact us at info@fake-biz.example.com</p></body></html>";

const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
  return new Response(PAGE_HTML, { status: 200 });
}) as typeof fetch;

function fakeBrowser(opts: { violations?: number } = {}): MinimalBrowser {
  const violations = Array.from({ length: opts.violations ?? 0 }, (_, i) => ({
    id: `rule-${i}`,
    impact: "serious",
    help: "Fix this",
    nodes: [{}],
  }));
  const page: MinimalPage = {
    url: () => "https://fake-biz.example.com/",
    goto: async () => undefined,
    title: async () => "Fake Biz",
    content: async () => PAGE_HTML,
    setViewportSize: async () => undefined,
    screenshot: async ({ path }) => writeFileSync(path, "fake-png"),
    addScriptTag: async () => undefined,
    evaluate: async <T>() => ({ violations }) as T,
    close: async () => undefined,
  };
  return { newPage: async () => page, close: async () => undefined };
}

describe("playwright auditor mode", () => {
  it("falls back to http mode without crashing when no browser is available", async () => {
    const audit = await auditWebsite(lead, {
      mode: "playwright",
      log,
      ticket,
      fetchImpl: fakeFetch,
      dataDir: mkdtempSync(join(tmpdir(), "waud-")),
      launchBrowser: async () => null,
    });
    expect(audit.mode).toBe("http");
    expect(audit.auditScore).toBeGreaterThan(0);
  });

  it("produces a browser-grade audit with screenshots, lighthouse, and a11y findings", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "waud-"));
    const audit = await auditWebsite(lead, {
      mode: "playwright",
      log,
      ticket,
      fetchImpl: fakeFetch,
      dataDir,
      launchBrowser: async () => fakeBrowser({ violations: 2 }),
      lighthouseRunner: async () => ({ performance: 55, accessibility: 70, bestPractices: 80, seo: 75 }),
    });
    expect(audit.mode).toBe("playwright");
    expect(audit.lighthouse?.performance).toBe(55);
    expect(audit.a11yFindings).toHaveLength(2);
    const page = audit.pages[0]!;
    expect(page.screenshotPath).toContain(join("screenshots", lead.id));
    expect(existsSync(page.screenshotPath!)).toBe(true);
    expect(existsSync(page.mobileScreenshotPath!)).toBe(true);
  });

  it("captures the mobile screenshot from a fresh mobile-emulated page, not a desktop resize", async () => {
    // A real phone honors <meta viewport> only under device emulation (isMobile),
    // and lays out from first paint at mobile width. Resizing an already-loaded
    // desktop page (setViewportSize) does neither → the capture diverges from a
    // real phone and feeds a false visual verdict + outreach claim. So the mobile
    // shot MUST come from a dedicated mobile-emulated page that navigates fresh.
    const newPageOpts: Array<Record<string, unknown> | undefined> = [];
    const gotoByPage: number[] = [];
    let resizeCalls = 0;

    function recordingBrowser(): MinimalBrowser {
      let pageIndex = -1;
      return {
        newPage: async (opts) => {
          const myIndex = ++pageIndex;
          newPageOpts.push(opts as Record<string, unknown> | undefined);
          gotoByPage[myIndex] = 0;
          const page: MinimalPage = {
            url: () => "https://fake-biz.example.com/",
            goto: async () => {
              gotoByPage[myIndex]!++;
              return undefined;
            },
            waitForLoadState: async () => undefined,
            waitForTimeout: async () => undefined,
            title: async () => "Fake Biz",
            content: async () => PAGE_HTML,
            setViewportSize: async () => {
              resizeCalls++;
            },
            screenshot: async ({ path }) => writeFileSync(path, "fake-png"),
            addScriptTag: async () => undefined,
            evaluate: async <T>() => ({ violations: [] }) as T,
            close: async () => undefined,
          };
          return page;
        },
        close: async () => undefined,
      };
    }

    const audit = await auditWebsite(lead, {
      mode: "playwright",
      log,
      ticket,
      fetchImpl: fakeFetch,
      dataDir: mkdtempSync(join(tmpdir(), "waud-")),
      launchBrowser: async () => recordingBrowser(),
      lighthouseRunner: async () => null,
    });

    // A dedicated mobile page was created with real device emulation at mobile width...
    const mobileIndex = newPageOpts.findIndex((o) => o?.isMobile === true);
    expect(mobileIndex).toBeGreaterThanOrEqual(0);
    expect(newPageOpts[mobileIndex]!.viewport).toMatchObject({ width: 390 });
    // ...and it navigated fresh (its own goto), so it renders AS a phone, not a resized desktop.
    expect(gotoByPage[mobileIndex]).toBeGreaterThanOrEqual(1);
    // The mobile capture must NOT be produced by resizing the desktop page.
    expect(resizeCalls).toBe(0);
    expect(existsSync(audit.pages[0]!.mobileScreenshotPath!)).toBe(true);
  });

  it("respects robots.txt in playwright mode", async () => {
    const blockingFetch = (async (input: string | URL | Request) => {
      if (String(input).endsWith("/robots.txt"))
        return new Response("User-agent: *\nDisallow: /", { status: 200 });
      return new Response(PAGE_HTML, { status: 200 });
    }) as typeof fetch;
    let launched = false;
    const audit = await auditWebsite(lead, {
      mode: "playwright",
      log,
      ticket,
      fetchImpl: blockingFetch,
      dataDir: mkdtempSync(join(tmpdir(), "waud-")),
      launchBrowser: async () => {
        launched = true;
        return fakeBrowser();
      },
    });
    expect(audit.robotsAllowed).toBe(false);
    expect(launched).toBe(false);
  });
});

describe("lighthouseSlowAngle (Lighthouse-gated slow claim)", () => {
  it("returns a plain-language slow angle ONLY when Lighthouse confirms (perf < 50)", () => {
    expect(lighthouseSlowAngle({ performance: 30, accessibility: 80, bestPractices: 80, seo: 80 })).toMatch(/slow to load/i);
    expect(lighthouseSlowAngle({ performance: 49, accessibility: 80, bestPractices: 80, seo: 80 })).toMatch(/slow to load/i);
  });
  it("returns null for a fast or unknown site (never claims slow without proof)", () => {
    expect(lighthouseSlowAngle({ performance: 50, accessibility: 80, bestPractices: 80, seo: 80 })).toBeNull();
    expect(lighthouseSlowAngle({ performance: 95, accessibility: 80, bestPractices: 80, seo: 80 })).toBeNull();
    expect(lighthouseSlowAngle({ performance: null, accessibility: 80, bestPractices: 80, seo: 80 })).toBeNull();
    expect(lighthouseSlowAngle(null)).toBeNull();
  });
});

describe("qualityCheckPreview", () => {
  function previewFile(): string {
    const dir = mkdtempSync(join(tmpdir(), "wprev-"));
    const path = join(dir, "index.html");
    writeFileSync(path, "<html><head><title>Preview</title></head><body>hi</body></html>", "utf8");
    return path;
  }

  it("returns null (skip) when no browser is available", async () => {
    const result = await qualityCheckPreview({
      previewPath: previewFile(),
      outDir: mkdtempSync(join(tmpdir(), "wshot-")),
      log,
      launchBrowser: async () => null,
    });
    expect(result).toBeNull();
  });

  it("gates on lighthouse thresholds and axe violations", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "wshot-"));
    const result = await qualityCheckPreview({
      previewPath: previewFile(),
      outDir,
      log,
      launchBrowser: async () => fakeBrowser({ violations: 0 }),
      lighthouseRunner: async () => ({ performance: 92, accessibility: 96, bestPractices: 90, seo: 88 }),
    });
    expect(result).not.toBeNull();
    expect(result!.lighthousePassed).toBe(true);
    expect(result!.a11yPassed).toBe(true);
    expect(result!.screenshotPaths).toHaveLength(2);
    expect(existsSync(result!.screenshotPaths[0]!)).toBe(true);

    const failing = await qualityCheckPreview({
      previewPath: previewFile(),
      outDir,
      log,
      launchBrowser: async () => fakeBrowser({ violations: 3 }),
      lighthouseRunner: async () => ({ performance: 40, accessibility: 60, bestPractices: 70, seo: 65 }),
    });
    expect(failing!.lighthousePassed).toBe(false);
    expect(failing!.a11yPassed).toBe(false);
  });
});
