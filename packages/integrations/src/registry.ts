import type { Logger, RuntimeConfig } from "@william/core";
import {
  createMockCalendar,
  createMockEmail,
  createMockEnrichment,
  createMockFirecrawl,
  createMockGithub,
  createMockHiggsfield,
  createMockInstantly,
  createMockLlm,
  createMockPlaces,
  createMockStripe,
  createMockTranscripts,
  createMockVercel,
} from "./mocks";
import { createFirecrawlAdapter } from "./real/firecrawl";
import { createGmailAdapter } from "./real/gmail";
import { createInstantlyAdapter } from "./real/instantly";
import { createLlmAdapter } from "./real/llm";
import type { RealDeps } from "./real/shared";
import { createStripeAdapter } from "./real/stripe";
import { createVercelAdapter } from "./real/vercel";
import type { Integrations } from "./types";

export type IntegrationName =
  | "instantly"
  | "gmail"
  | "stripe"
  | "vercel"
  | "github"
  | "google_maps"
  | "enrichment"
  | "email_verify"
  | "calendar"
  | "higgsfield"
  | "firecrawl"
  | "anthropic";

export interface CredentialReport {
  integration: IntegrationName;
  mode: "missing" | "sandbox" | "live";
  detail: string;
}

/** Reads env-derived credential presence. Live/sandbox distinction comes from WILLIAM_ENV. */
export function detectCredentials(env: NodeJS.ProcessEnv, williamEnv: RuntimeConfig["env"]): CredentialReport[] {
  const mode = (present: boolean): CredentialReport["mode"] =>
    !present ? "missing" : williamEnv === "production" ? "live" : "sandbox";
  return [
    { integration: "instantly", mode: mode(!!env.INSTANTLY_API_KEY), detail: "INSTANTLY_API_KEY" },
    { integration: "gmail", mode: mode(!!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN)), detail: "GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN" },
    { integration: "stripe", mode: mode(!!env.STRIPE_SECRET_KEY), detail: "STRIPE_SECRET_KEY" },
    { integration: "vercel", mode: mode(!!env.VERCEL_TOKEN), detail: "VERCEL_TOKEN" },
    { integration: "github", mode: mode(!!env.GITHUB_TOKEN), detail: "GITHUB_TOKEN" },
    { integration: "google_maps", mode: mode(!!env.GOOGLE_MAPS_API_KEY), detail: "GOOGLE_MAPS_API_KEY" },
    { integration: "enrichment", mode: mode(!!env.ENRICHMENT_API_KEY), detail: "ENRICHMENT_API_KEY" },
    { integration: "email_verify", mode: mode(!!env.EMAIL_VERIFY_API_KEY), detail: "EMAIL_VERIFY_API_KEY" },
    { integration: "calendar", mode: mode(!!(env.GMAIL_CLIENT_ID && env.GMAIL_REFRESH_TOKEN)), detail: "Google OAuth (shared with Gmail)" },
    { integration: "higgsfield", mode: mode(env.HIGGSFIELD_ENABLED === "true"), detail: "HIGGSFIELD_ENABLED + MCP access" },
    { integration: "firecrawl", mode: mode(!!env.FIRECRAWL_API_KEY), detail: "FIRECRAWL_API_KEY" },
    { integration: "anthropic", mode: mode(!!env.ANTHROPIC_API_KEY), detail: "ANTHROPIC_API_KEY (per-task models: visual/outreach/classify=Haiku, build=Sonnet)" },
  ];
}

/**
 * Adapter factory. Credential presence selects the REAL adapter; everything
 * else stays mock. Real adapters still simulate whenever ticket.dryRun is
 * true (local env always is), so creds in a local .env remain side-effect
 * free. github/enrichment/places/calendar/transcripts/higgsfield: mock until
 * their phases (TODO(phase-d)/(phase-e)).
 */
export function createIntegrations(
  _config: RuntimeConfig,
  log: Logger,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Integrations {
  const env = opts.env ?? process.env;
  const deps: RealDeps = { env, fetchImpl: opts.fetchImpl };
  const gmailReady = !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
  // Webhook verification scheme follows the ACTIVE adapter (keyed to the API
  // key). A webhook secret without its API key means real provider webhooks
  // get verified by the mock's scheme and fail closed — warn loudly.
  if (env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_SECRET_KEY) {
    log.warn("STRIPE_WEBHOOK_SECRET is set without STRIPE_SECRET_KEY — real Stripe webhooks will be rejected (mock scheme active)");
  }
  if (env.INSTANTLY_WEBHOOK_SECRET && !env.INSTANTLY_API_KEY) {
    log.warn("INSTANTLY_WEBHOOK_SECRET is set without INSTANTLY_API_KEY — Instantly webhooks verified by mock adapter");
  }
  return {
    email: gmailReady ? createGmailAdapter(deps, log) : createMockEmail(log),
    instantly: env.INSTANTLY_API_KEY ? createInstantlyAdapter(deps, log) : createMockInstantly(log),
    stripe: env.STRIPE_SECRET_KEY ? createStripeAdapter(deps, log) : createMockStripe(log),
    vercel: env.VERCEL_TOKEN ? createVercelAdapter(deps, log) : createMockVercel(log),
    github: createMockGithub(),
    enrichment: createMockEnrichment(),
    places: createMockPlaces(),
    calendar: createMockCalendar(),
    transcripts: createMockTranscripts(),
    higgsfield: createMockHiggsfield(log),
    firecrawl: env.FIRECRAWL_API_KEY ? createFirecrawlAdapter(deps, log) : createMockFirecrawl(log),
    llm: env.ANTHROPIC_API_KEY ? createLlmAdapter(deps, log) : createMockLlm(log),
  };
}
