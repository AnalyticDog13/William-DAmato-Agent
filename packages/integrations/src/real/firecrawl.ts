import { CompanyFacts, type Logger } from "@william/core";
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
 * Response shape (Firecrawl v1, confirmed against the docs): `{ success, data:
 * { markdown, links, metadata: { title, description, sourceURL, statusCode, … } } }`.
 * `metadata.title`/`description` may be a string OR an array of strings, so we
 * normalize. `onlyMainContent: false` keeps footer contact details in the markdown.
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
        // onlyMainContent:false so footer contact info (email/phone) survives.
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: false }),
      });
      if (!res.ok) {
        log.warn("firecrawl scrape failed; falling back to audit-derived facts", { status: res.status });
        return synthesizeCompanyFacts(url, hints);
      }
      return mergeScrape(res.body, url, hints);
    },
  };
}

/**
 * Map a Firecrawl response onto CompanyFacts, using audit hints as the floor.
 * Audit-confirmed contact values are never overridden by scraped ones; the scrape
 * only FILLS gaps. The scraped page text is DATA only — stored as facts, never
 * executed or prompted as instructions (invariant 1).
 */
function mergeScrape(body: Record<string, unknown>, url: string, hints?: CompanyScrapeHints): CompanyFacts {
  const base = synthesizeCompanyFacts(url, hints);
  const data = (body.data ?? body) as Record<string, unknown>;
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const markdown = typeof data.markdown === "string" ? data.markdown : "";

  const description = metaString(meta.description);
  const about = description || base.about || (markdown ? markdown.slice(0, 400) : "");

  return CompanyFacts.parse({
    ...base,
    about,
    contact: {
      ...base.contact,
      email: base.contact.email ?? firstEmail(markdown),
      phone: base.contact.phone ?? firstPhone(markdown),
    },
  });
}

/** Firecrawl metadata fields may be a string OR an array of strings. */
function metaString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === "string" && v.trim());
    return typeof first === "string" ? first.trim() : "";
  }
  return "";
}

// Cap how much scraped text the contact extractors scan — contact details live
// near the top/footer, and bounding the input keeps extraction cheap and safe on
// adversarially large/numeric pages.
const SCAN_LIMIT = 20_000;

/** First email address found in the scraped text, or null. */
function firstEmail(text: string): string | null {
  const m = text.slice(0, SCAN_LIMIT).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

/** First plausible phone number (10–15 digits) found in the scraped text, or null.
 * The candidate length is bounded so a long numeric run can't be mistaken for one. */
function firstPhone(text: string): string | null {
  const matches = text.slice(0, SCAN_LIMIT).match(/\+?\(?\d[\d().\-\s]{6,18}\d/g) ?? [];
  for (const candidate of matches) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return candidate.trim();
  }
  return null;
}
