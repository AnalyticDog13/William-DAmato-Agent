import type { AppContext } from "./context";

/**
 * Bootstraps OwnerRequests for every missing credential so the owner always
 * has a concrete, prioritized to-do list instead of silent dead ends.
 */
export function ensureBootstrapOwnerRequests(ctx: AppContext): void {
  const missing = new Set(
    ctx.store.credentialStatuses.list({ status: "missing", limit: 50 }).map((c) => c.integration),
  );

  if (missing.has("instantly")) {
    ctx.memory.requestFromOwner({
      title: "Provide Instantly API v2 key + campaign ID",
      whyItMatters: "Outreach sends and reply polling all flow through Instantly. Without it, approved drafts stop at dry-run.",
      neededFields: ["INSTANTLY_API_KEY", "INSTANTLY_CAMPAIGN_ID"],
      credentialKind: "live",
      unblocks: ["real first-touch sends after approval", "reply detection via poller", "campaign sync status"],
      category: "credentials",
    });
  }
  if (missing.has("google_maps")) {
    ctx.memory.requestFromOwner({
      title: "Provide Google Maps Places API key",
      whyItMatters: "Lead discovery by niche + location runs on the Places API. Activation is additionally gated by ACTIVATE_NEW_LEAD_SOURCE.",
      neededFields: ["GOOGLE_MAPS_API_KEY (Places API enabled, billing on)"],
      credentialKind: "live",
      unblocks: ["automated lead discovery beyond CSV/manual entry"],
      category: "credentials",
    });
  }
  if (missing.has("anthropic")) {
    ctx.memory.requestFromOwner({
      title: "Provide Anthropic API key (per-task models: Haiku for visual/outreach/classify, Sonnet 4.6 for build prompts)",
      whyItMatters: "Build-prompt generation, outreach personalization, reply classification, transcript extraction, and visual scoring run on deterministic templates/heuristics until an Anthropic key exists. The key upgrades them to real model output; scraped/audit text stays quoted material (invariant 1).",
      neededFields: [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_MODEL (optional; global default Haiku — claude-haiku-4-5-20251001 — drives reply classification + transcripts)",
        "ANTHROPIC_BUILD_MODEL (optional; defaults to Sonnet 4.6 — claude-sonnet-4-6 — for build prompts)",
        "ANTHROPIC_OUTREACH_MODEL / ANTHROPIC_VISUAL_MODEL (optional; default to Haiku)",
      ],
      credentialKind: "live",
      unblocks: ["real website build prompts (Sonnet 4.6)", "personalized outreach copy + reply classification + visual scoring (Haiku)"],
      category: "credentials",
    });
  }
  if (missing.has("enrichment")) {
    ctx.memory.requestFromOwner({
      title: "Provide enrichment provider API key (optional — widens email discovery)",
      whyItMatters: "Leads with no published email on their website or subpages are disqualified today. An enrichment provider can surface a verified contact, recovering those leads.",
      neededFields: ["ENRICHMENT_API_KEY"],
      credentialKind: "live",
      unblocks: ["email discovery for leads with no published contact address"],
      category: "credentials",
    });
  }
  if (missing.has("email_verify")) {
    ctx.memory.requestFromOwner({
      title: "Provide email verification API key (optional — confirms deliverability)",
      whyItMatters: "The current email verifier checks format only. A real deliverability verifier confirms inbox existence before a send, reducing bounce rate.",
      neededFields: ["EMAIL_VERIFY_API_KEY"],
      credentialKind: "live",
      unblocks: ["deliverability verification before first-touch send"],
      category: "credentials",
    });
  }
}
