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
      title: "Provide Instantly API v2 key + webhook secret",
      whyItMatters: "Outreach sends and reply/bounce/unsubscribe webhooks all flow through Instantly. Without it, approved drafts stop at dry-run.",
      neededFields: ["INSTANTLY_API_KEY", "INSTANTLY_WEBHOOK_SECRET", "campaign ID for first-touch sequence"],
      credentialKind: "live",
      unblocks: ["real first-touch sends after approval", "reply detection", "campaign sync status"],
      category: "credentials",
    });
  }
  if (missing.has("gmail")) {
    ctx.memory.requestFromOwner({
      title: "Authorize Gmail API OAuth for will@williamdamato.com",
      whyItMatters: "Direct-send fallback and mailbox-level reply ingestion need Gmail API OAuth (client id/secret + refresh token).",
      neededFields: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
      credentialKind: "live",
      unblocks: ["direct email fallback", "thread-level reply context", "calendar free/busy for call suggestions"],
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
  if (missing.has("stripe")) {
    ctx.memory.requestFromOwner({
      title: "Provide Stripe secret key + webhook secret (test mode first)",
      whyItMatters: "Payment links/invoices stay simulated until Stripe credentials exist. Test-mode keys are enough to validate the full flow.",
      neededFields: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      credentialKind: "sandbox",
      unblocks: ["real (test-mode) payment links", "payment webhook state tracking"],
      category: "credentials",
    });
  }
  if (missing.has("vercel")) {
    ctx.memory.requestFromOwner({
      title: "Provide Vercel token (+ team id) for preview deployments",
      whyItMatters: "Generated preview sites currently live as local files; a Vercel token turns them into shareable preview URLs.",
      neededFields: ["VERCEL_TOKEN", "VERCEL_TEAM_ID (if team account)"],
      credentialKind: "either",
      unblocks: ["shareable preview URLs", "production deploys (still DEPLOY_PRODUCTION-gated)"],
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
  if (missing.has("firecrawl")) {
    ctx.memory.requestFromOwner({
      title: "Provide Firecrawl API key for real company scraping",
      whyItMatters: "Website briefs currently synthesize company facts from the audit. A Firecrawl key lets William scrape the lead's real site (services, hours, about, contact) for a richer, more accurate build prompt.",
      neededFields: ["FIRECRAWL_API_KEY"],
      credentialKind: "live",
      unblocks: ["real scraped company facts in website briefs"],
      category: "credentials",
    });
  }
  if (missing.has("vercel")) {
    ctx.memory.requestFromOwner({
      title: "Enable Vercel repo/git-source deploy for shipping owner-built sites",
      whyItMatters: "site.ship deploys the owner's finished repo. Real repo/git-source deploys (vs the current dry-run) need a Vercel token plus git-source configuration; until then shipping simulates.",
      neededFields: ["VERCEL_TOKEN", "VERCEL_TEAM_ID (if team account)", "git source connected to Vercel for the repo"],
      credentialKind: "live",
      unblocks: ["real production deploy of the owner's finished website repo (site.ship)"],
      category: "credentials",
    });
  }
  if (missing.has("higgsfield")) {
    ctx.memory.requestFromOwner({
      title: "Confirm Higgsfield MCP usage limits and allowed use",
      whyItMatters: "The $60/mo plan is available, but William keeps Higgsfield in dry-run until credit limits and acceptable-use are confirmed to avoid burning plan credits.",
      neededFields: ["confirmation of monthly credit budget for William", "HIGGSFIELD_ENABLED=true"],
      credentialKind: "live",
      unblocks: ["hero/mockup imagery for preview sites", "design-reference generation"],
      category: "decision",
    });
  }
}
