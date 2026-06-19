import { extractEmails, firstRealEmail, type Lead, type Logger, type PolicyTicket } from "@william/core";
import { checkRobots } from "./audit";
import type { ChromiumLauncher } from "./browser";

export interface EmailCrawlDeps {
  log: Logger;
  /** Operational ticket authorizing the crawl (mirrors AuditorDeps.ticket). The
   *  crawl simulates (returns empty) under ticket.dryRun — invariant 2. */
  ticket: PolicyTicket;
  launchBrowser: ChromiumLauncher;
  fetchImpl?: typeof fetch;
  subpaths: string[];
  maxPages: number;
}

/**
 * SLOW fallback email discovery — call only after the cheap homepage regex
 * misses or returns only placeholders. Renders the homepage + likely subpaths
 * with headless Chromium (networkidle), reads BOTH innerText and raw HTML, and
 * returns the first real (non-placeholder) email. Honors robots.txt; returns
 * { null, null } when disallowed or no browser is available. Never throws.
 *
 * Crawled text is DATA only — it feeds the regex extractor, never an LLM prompt
 * or any executor (invariant 1).
 */
export async function crawlForEmail(
  lead: Lead,
  deps: EmailCrawlDeps,
): Promise<{ email: string | null; foundOn: string | null }> {
  if (deps.ticket.dryRun) return { email: null, foundOn: null }; // local never hits the network
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (!lead.websiteUrl) return { email: null, foundOn: null };
  const origin = new URL(lead.websiteUrl).origin;

  if (!(await checkRobots(origin, fetchImpl))) {
    deps.log.warn("robots.txt disallows crawling; skipping email crawl", { leadId: lead.id });
    return { email: null, foundOn: null };
  }

  const urls = [...new Set([lead.websiteUrl, ...deps.subpaths.map((p) => origin + p)])].slice(0, deps.maxPages);
  const browser = await deps.launchBrowser(deps.log);
  if (!browser) return { email: null, foundOn: null };

  try {
    const page = await browser.newPage();
    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
        const html = await page.content();
        const innerText = await page.evaluate<string>(
          () => (globalThis as unknown as { document?: { body?: { innerText?: string } } }).document?.body?.innerText ?? "",
        );
        const email = firstRealEmail(extractEmails(`${innerText}\n${html}`));
        if (email) return { email, foundOn: url };
      } catch (err) {
        deps.log.warn("email-crawl page failed; continuing", { url, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { email: null, foundOn: null };
  } finally {
    await browser.close().catch(() => {});
  }
}
