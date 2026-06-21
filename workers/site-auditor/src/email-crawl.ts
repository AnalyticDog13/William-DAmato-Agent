import { bestBusinessEmail, extractEmails, isTopTierContact, type Lead, type Logger, type PolicyTicket } from "@william/core";
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
  /** Per-page navigation timeout (ms). */
  pageTimeoutMs: number;
  /** Overall wall-clock budget (ms) for the whole crawl — stops early so one
   *  slow site can't blow the per-lead time. */
  budgetMs: number;
  /** Business name, for ranking a company-named free-provider address. */
  companyName?: string | null;
}

/**
 * SLOW fallback email discovery — call only after the cheap homepage pass
 * misses or returns a non-top-tier address. Renders the homepage + likely
 * subpaths with headless Chromium, reads BOTH innerText and raw HTML, collects
 * every candidate across pages, and returns the BEST-RANKED business email
 * (bestBusinessEmail) — so a real service address wins even when raw-HTML or
 * third-party junk appeared first. Stops early once a role@own-domain address is
 * found. Honors robots.txt; returns { null, null } when disallowed or no browser
 * is available. Never throws.
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

  const emailCtx = { siteUrl: lead.websiteUrl, companyName: deps.companyName ?? null };
  try {
    const page = await browser.newPage();
    const startedAt = Date.now();
    const candidates: { email: string; url: string }[] = [];
    for (const url of urls) {
      // Overall budget guard: a site that never settles (a real lead's site hit
      // the timeout on every page) must not blow the per-lead time. Stop early.
      if (Date.now() - startedAt > deps.budgetMs) {
        deps.log.warn("email-crawl budget exceeded; stopping", { leadId: lead.id, elapsedMs: Date.now() - startedAt });
        break;
      }
      try {
        // domcontentloaded (not networkidle): the DOM is parsed and contact text
        // is readable, but we don't wait on analytics/sockets that keep a site
        // from ever reaching network-idle. Far faster, bounded per page.
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: deps.pageTimeoutMs });
        const html = await page.content();
        const innerText = await page.evaluate<string>(
          () => (globalThis as unknown as { document?: { body?: { innerText?: string } } }).document?.body?.innerText ?? "",
        );
        for (const email of extractEmails(`${innerText}\n${html}`)) {
          if (!candidates.some((c) => c.email === email)) candidates.push({ email, url });
        }
        // Best possible contact found (role@own-domain) — no better page to find.
        if (candidates.some((c) => isTopTierContact(c.email, emailCtx))) break;
      } catch (err) {
        deps.log.warn("email-crawl page failed; continuing", { url, error: err instanceof Error ? err.message : String(err) });
      }
    }
    // Rank ALL candidates collected across pages so the real service address wins
    // even when raw-HTML / third-party junk appeared first or on an earlier page.
    const best = bestBusinessEmail(candidates.map((c) => c.email), emailCtx);
    if (!best) return { email: null, foundOn: null };
    return { email: best, foundOn: candidates.find((c) => c.email === best)?.url ?? null };
  } finally {
    await browser.close().catch(() => {});
  }
}
