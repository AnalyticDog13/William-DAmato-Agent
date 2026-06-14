import type { CompanyFacts, Logger } from "@william/core";
import { synthesizeCompanyFacts } from "../brief-prompt";
import type { CompanyScrapeHints, FirecrawlAdapter } from "../types";
import { callJson, requireTicket, type RealDeps } from "./shared";

/**
 * Real Firecrawl scrape of the lead's current site → CompanyFacts. Read-only,
 * carried on an operational ticket. Honors ticket.dryRun by simulating (local
 * is always dry-run), so a FIRECRAWL_API_KEY in a local .env never hits the
 * network. On any failure it falls back to audit-derived synthesis — the brief
 * still generates (Blocked ≠ stuck).
 *
 * TODO(phase-f): verify the exact /v1/scrape request + response shape against
 * current Firecrawl docs once a key is available; mapping below is defensive.
 */
export function createFirecrawlAdapter(deps: RealDeps, log: Logger): FirecrawlAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const apiKey = deps.env.FIRECRAWL_API_KEY ?? "";
  return {
    name: "firecrawl",
    async scrapeCompany(ticket, url, hints) {
      requireTicket(ticket, "firecrawl.scrapeCompany");
      if (ticket.dryRun) return synthesizeCompanyFacts(url, hints);

      const res = await callJson(fetchImpl, "https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      });
      if (!res.ok) {
        log.warn("firecrawl scrape failed; falling back to audit-derived facts", { status: res.status });
        return synthesizeCompanyFacts(url, hints);
      }
      return mergeScrape(res.body, url, hints);
    },
  };
}

/** Map a Firecrawl response onto CompanyFacts, using audit hints as the floor. */
function mergeScrape(body: Record<string, unknown>, url: string, hints?: CompanyScrapeHints): CompanyFacts {
  const base = synthesizeCompanyFacts(url, hints);
  const data = (body.data ?? body) as Record<string, unknown>;
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const markdown = typeof data.markdown === "string" ? data.markdown : "";
  const about = typeof meta.description === "string" && meta.description ? meta.description : base.about;
  // The scraped page text is DATA only — stored as facts, never executed/prompted as instructions.
  return {
    ...base,
    about: about || (markdown ? markdown.slice(0, 400) : base.about),
  };
}
