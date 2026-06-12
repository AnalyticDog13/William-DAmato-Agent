import type { Logger, RuntimeConfig } from "@william/core";
import {
  createMockCalendar,
  createMockEmail,
  createMockEnrichment,
  createMockGithub,
  createMockHiggsfield,
  createMockInstantly,
  createMockPlaces,
  createMockStripe,
  createMockTranscripts,
  createMockVercel,
} from "./mocks";
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
  | "higgsfield";

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
  ];
}

/**
 * Adapter factory. Phase A/B: mocks only. Real implementations land in
 * Phase C behind the same interfaces; selection will key off credential
 * presence + WILLIAM_ENV (TODO(phase-c): real adapters).
 */
export function createIntegrations(_config: RuntimeConfig, log: Logger): Integrations {
  return {
    email: createMockEmail(log),
    instantly: createMockInstantly(log),
    stripe: createMockStripe(log),
    vercel: createMockVercel(log),
    github: createMockGithub(),
    enrichment: createMockEnrichment(),
    places: createMockPlaces(),
    calendar: createMockCalendar(),
    transcripts: createMockTranscripts(),
    higgsfield: createMockHiggsfield(log),
  };
}
