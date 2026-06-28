import { bestBusinessEmail, extractEmails, isPlaceholderEmail } from "@william/core";

/**
 * Fetch the homepage via a plain HTTP GET and return ranked, placeholder-filtered
 * email addresses found in the response body.
 *
 * Dry-run safe: returns `[]` immediately when `ticket.dryRun` is true (zero network).
 * Fail-closed: any HTTP error, non-ok response, or parse failure returns `[]`.
 *
 * This is the cheap first rung of email discovery — no browser, no JS execution.
 * It runs BEFORE the Playwright subpage crawl to avoid spinning up Chromium for
 * leads whose contact email is already visible in the homepage source.
 */
export async function fetchHomepageEmails(
  url: string,
  opts: {
    fetchImpl?: typeof fetch;
    ticket: { dryRun: boolean };
    companyName?: string | null;
  },
): Promise<string[]> {
  if (opts.ticket.dryRun || !url) return [];
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const html = await res.text();
    const found = extractEmails(html).filter((e) => !isPlaceholderEmail(e));
    if (found.length === 0) return [];
    const best = bestBusinessEmail(found, { siteUrl: url, companyName: opts.companyName ?? null });
    // Return the best-ranked address first, then the remainder in stable input order.
    return best ? [best, ...found.filter((e) => e !== best)] : found;
  } catch {
    return [];
  }
}
