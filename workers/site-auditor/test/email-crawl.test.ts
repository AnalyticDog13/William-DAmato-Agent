// workers/site-auditor/test/email-crawl.test.ts
import { describe, expect, it } from "vitest";
import type { ChromiumLauncher, MinimalBrowser, MinimalPage } from "../src/browser";
import { crawlForEmail } from "../src/email-crawl";

const testLog = { info() {}, warn() {}, error() {}, debug() {} } as any;
const lead = { id: "lead_1", websiteUrl: "https://joesbarber.com", domain: "joesbarber.com" } as any;
const liveTicket = { dryRun: false } as any;
const dryRunTicket = { dryRun: true } as any;

// fetch stub: robots.txt allows everything
const allowFetch = (async () => ({ ok: true, text: async () => "User-agent: *\nAllow: /" })) as unknown as typeof fetch;

function fakeLauncher(pages: Record<string, { html: string; innerText: string }>): ChromiumLauncher {
  return async () => {
    let current = "";
    const page: MinimalPage = {
      url: () => current,
      async goto(url) { current = url; return null; },
      async title() { return ""; },
      async content() { return pages[current]?.html ?? ""; },
      async setViewportSize() {},
      async screenshot() { return null; },
      async addScriptTag() { return null; },
      async evaluate<T>() { return (pages[current]?.innerText ?? "") as unknown as T; },
      async close() {},
    };
    const browser: MinimalBrowser = { async newPage() { return page; }, async close() {} };
    return browser;
  };
}

describe("crawlForEmail", () => {
  it("finds a real email on a subpage and reports where", async () => {
    const launcher = fakeLauncher({
      "https://joesbarber.com": { html: "<p>info@example.com</p>", innerText: "info@example.com" },
      "https://joesbarber.com/contact": { html: "<p>owner@joesbarber.com</p>", innerText: "Call or email owner@joesbarber.com" },
    });
    const out = await crawlForEmail(lead, { log: testLog, ticket: liveTicket, launchBrowser: launcher, fetchImpl: allowFetch, subpaths: ["/contact"], maxPages: 8, pageTimeoutMs: 8_000, budgetMs: 25_000 });
    expect(out.email).toBe("owner@joesbarber.com");
    expect(out.foundOn).toBe("https://joesbarber.com/contact");
  });

  it("returns null when only placeholder emails exist", async () => {
    const launcher = fakeLauncher({ "https://joesbarber.com": { html: "info@example.com", innerText: "info@example.com" } });
    const out = await crawlForEmail(lead, { log: testLog, ticket: liveTicket, launchBrowser: launcher, fetchImpl: allowFetch, subpaths: [], maxPages: 8, pageTimeoutMs: 8_000, budgetMs: 25_000 });
    expect(out.email).toBeNull();
  });

  it("returns null when the browser is unavailable", async () => {
    const out = await crawlForEmail(lead, { log: testLog, ticket: liveTicket, launchBrowser: async () => null, fetchImpl: allowFetch, subpaths: ["/contact"], maxPages: 8, pageTimeoutMs: 8_000, budgetMs: 25_000 });
    expect(out).toEqual({ email: null, foundOn: null });
  });

  it("aborts (null) when robots.txt disallows the site", async () => {
    const blockFetch = (async () => ({ ok: true, text: async () => "User-agent: *\nDisallow: /" })) as unknown as typeof fetch;
    const launcher = fakeLauncher({ "https://joesbarber.com/contact": { html: "owner@joesbarber.com", innerText: "owner@joesbarber.com" } });
    const out = await crawlForEmail(lead, { log: testLog, ticket: liveTicket, launchBrowser: launcher, fetchImpl: blockFetch, subpaths: ["/contact"], maxPages: 8, pageTimeoutMs: 8_000, budgetMs: 25_000 });
    expect(out.email).toBeNull();
  });

  it("simulates (returns null) under ticket.dryRun without launching a browser", async () => {
    let launched = false;
    const launcher: ChromiumLauncher = async () => { launched = true; return null; };
    const out = await crawlForEmail(lead, { log: testLog, ticket: dryRunTicket, launchBrowser: launcher, fetchImpl: allowFetch, subpaths: ["/contact"], maxPages: 8, pageTimeoutMs: 8_000, budgetMs: 25_000 });
    expect(out).toEqual({ email: null, foundOn: null });
    expect(launched).toBe(false);
  });
});
