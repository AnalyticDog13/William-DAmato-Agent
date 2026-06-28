import { createHmac, timingSafeEqual } from "node:crypto";
import { newId, type Logger, type PolicyTicket } from "@william/core";
import type {
  DiscoveredBusiness,
  EnrichmentAdapter,
  InstantlyAdapter,
  LlmAdapter,
  PlacesAdapter,
} from "./types";

/**
 * Mock adapters: same interface as the real ones, zero external calls.
 * They behave as if everything worked, always reporting dryRun honestly,
 * so the entire pipeline is explorable before any credentials exist.
 */

function requireTicket(ticket: PolicyTicket, action: string): void {
  if (!ticket?.__policyTicket) {
    throw new Error(`SECURITY: ${action} called without a PolicyTicket — this is a bug.`);
  }
}

function simulated(action: string, detail: string, prefix: string): import("./types").ExecutionResult {
  return { dryRun: true, ok: true, externalId: newId(prefix), detail: `[MOCK/DRY-RUN] ${action}: ${detail}` };
}

export function hmacSignatureValid(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = Buffer.from(signatureHeader);
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function createMockInstantly(log: Logger): InstantlyAdapter {
  return {
    name: "mock-instantly",
    async pushLead(ticket, input) {
      requireTicket(ticket, "instantly.pushLead");
      log.info("mock instantly pushLead", { email: input.email, dryRun: ticket.dryRun });
      return simulated("instantly.pushLead", `email=${input.email}`, "inst");
    },
    verifyWebhookSignature: hmacSignatureValid,
  };
}

export function createMockEnrichment(): EnrichmentAdapter {
  return {
    name: "mock-enrichment",
    async findContacts(ticket, _domain) {
      requireTicket(ticket, "enrichment.findContacts");
      // We never GUESS a contact (no info@<domain> fabrication): a lead with no
      // real email found on the site is not contactable. Real enrichment data
      // arrives only with a configured provider (ENRICHMENT_API_KEY) once a real
      // adapter is wired; until then this returns nothing.
      return [];
    },
    async verifyEmail(ticket, email) {
      requireTicket(ticket, "enrichment.verifyEmail");
      // Mock heuristic: well-formed addresses on real-looking domains are "valid".
      const ok = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email);
      return ok
        ? { status: "valid", detail: "[MOCK] format plausible; real verification requires a provider." }
        : { status: "invalid", detail: "[MOCK] malformed address." };
    },
  };
}

const MOCK_BUSINESSES: DiscoveredBusiness[] = [
  { name: "Fade Factory Barbershop", niche: "barbershop", websiteUrl: null, phone: "+1-607-555-0141", address: "112 State St", city: "Ithaca", rating: 4.7 },
  { name: "Collegetown Cuts", niche: "barbershop", websiteUrl: "http://collegetowncuts.example.com", phone: "+1-607-555-0182", address: "402 College Ave", city: "Ithaca", rating: 4.4 },
  { name: "Gimme Beans Coffee", niche: "coffee_shop", websiteUrl: "http://gimmebeans.example.com", phone: "+1-607-555-0123", address: "506 W State St", city: "Ithaca", rating: 4.8 },
];

export function createMockPlaces(): PlacesAdapter {
  return {
    name: "mock-google-maps",
    async searchBusinesses(ticket, input) {
      requireTicket(ticket, "places.searchBusinesses");
      // Page 1 returns the canned businesses; no further pages.
      const businesses = input.pageToken ? [] : MOCK_BUSINESSES.map((b) => ({ ...b, phone: null }));
      return { businesses, nextPageToken: null };
    },
  };
}

export function createMockLlm(log: Logger): LlmAdapter {
  return {
    name: "mock-llm",
    async scoreVisualDesign(ticket) {
      requireTicket(ticket, "llm.scoreVisualDesign");
      log.debug?.("mock llm scoreVisualDesign");
      // No real LLM: signal "score deterministically only" via null.
      return null;
    },
  };
}
