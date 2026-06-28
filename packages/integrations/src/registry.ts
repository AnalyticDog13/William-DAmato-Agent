import type { Logger, RuntimeConfig } from "@william/core";
import {
  createMockEnrichment,
  createMockInstantly,
  createMockLlm,
  createMockPlaces,
} from "./mocks";
import { createInstantlyAdapter } from "./real/instantly";
import { createLlmAdapter } from "./real/llm";
import { createPlacesAdapter } from "./real/places";
import type { RealDeps } from "./real/shared";
import type { Integrations } from "./types";

export type IntegrationName =
  | "instantly"
  | "google_maps"
  | "enrichment"
  | "email_verify"
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
    { integration: "google_maps", mode: mode(!!env.GOOGLE_MAPS_API_KEY), detail: "GOOGLE_MAPS_API_KEY" },
    { integration: "enrichment", mode: mode(!!env.ENRICHMENT_API_KEY), detail: "ENRICHMENT_API_KEY" },
    { integration: "email_verify", mode: mode(!!env.EMAIL_VERIFY_API_KEY), detail: "EMAIL_VERIFY_API_KEY" },
    { integration: "anthropic", mode: mode(!!env.ANTHROPIC_API_KEY), detail: "ANTHROPIC_API_KEY (per-task models: visual=Haiku)" },
  ];
}

/**
 * Adapter factory. Credential presence selects the REAL adapter; everything
 * else stays mock. Real adapters still simulate whenever ticket.dryRun is
 * true (local env always is), so creds in a local .env remain side-effect
 * free.
 */
export function createIntegrations(
  _config: RuntimeConfig,
  log: Logger,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Integrations {
  const env = opts.env ?? process.env;
  const deps: RealDeps = { env, fetchImpl: opts.fetchImpl };
  return {
    instantly: env.INSTANTLY_API_KEY ? createInstantlyAdapter(deps, log) : createMockInstantly(log),
    enrichment: createMockEnrichment(),
    places: env.GOOGLE_MAPS_API_KEY ? createPlacesAdapter(deps, log) : createMockPlaces(),
    llm: env.ANTHROPIC_API_KEY ? createLlmAdapter(deps, log) : createMockLlm(log),
  };
}
