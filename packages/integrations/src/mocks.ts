import { createHmac, timingSafeEqual } from "node:crypto";
import { newId, type Logger, type PolicyTicket } from "@william/core";
import { synthesizeCompanyFacts, templateBuildPrompt } from "./brief-prompt";
import type {
  CalendarAdapter,
  DiscoveredBusiness,
  EmailAdapter,
  EnrichmentAdapter,
  ExecutionResult,
  FirecrawlAdapter,
  GithubAdapter,
  HiggsfieldAdapter,
  InstantlyAdapter,
  LlmAdapter,
  PlacesAdapter,
  StripeAdapter,
  TranscriptIngestionAdapter,
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

function simulated(action: string, detail: string, prefix: string): ExecutionResult {
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

export function createMockEmail(log: Logger): EmailAdapter {
  return {
    name: "mock-gmail",
    async send(ticket, email) {
      requireTicket(ticket, "email.send");
      if (!email.body.includes(email.optOutLine)) {
        return { dryRun: true, ok: false, detail: "REFUSED: outbound email missing opt-out line." };
      }
      log.info("mock email send", { to: email.to, subject: email.subject, dryRun: ticket.dryRun });
      return simulated("email.send", `to=${email.to} subject="${email.subject}"`, "msg");
    },
  };
}

export function createMockInstantly(log: Logger): InstantlyAdapter {
  return {
    name: "mock-instantly",
    async pushLead(ticket, input) {
      requireTicket(ticket, "instantly.pushLead");
      log.info("mock instantly pushLead", { email: input.email, dryRun: ticket.dryRun });
      return simulated("instantly.pushLead", `email=${input.email}`, "inst");
    },
    async pauseLead(ticket, externalLeadId) {
      requireTicket(ticket, "instantly.pauseLead");
      return simulated("instantly.pauseLead", `lead=${externalLeadId}`, "inst");
    },
    async pollInbound(ticket) {
      requireTicket(ticket, "instantly.pollInbound");
      return []; // mock/dry-run surfaces no inbound mail
    },
    verifyWebhookSignature: hmacSignatureValid,
  };
}

export function createMockStripe(log: Logger): StripeAdapter {
  return {
    name: "mock-stripe",
    async createPaymentLink(ticket, input) {
      requireTicket(ticket, "stripe.createPaymentLink");
      const id = newId("plink");
      log.info("mock stripe payment link", { amountUsd: input.amountUsd, dryRun: ticket.dryRun });
      return {
        dryRun: true,
        ok: true,
        externalId: id,
        url: `https://buy.stripe.example/${id}`,
        detail: `[MOCK/DRY-RUN] payment link $${input.amountUsd} — ${input.description}`,
      };
    },
    async createInvoiceDraft(ticket, input) {
      requireTicket(ticket, "stripe.createInvoiceDraft");
      return simulated("stripe.createInvoiceDraft", `${input.customerEmail} $${input.amountUsd}`, "inv");
    },
    verifyWebhookSignature: hmacSignatureValid,
  };
}

export function createMockVercel(log: Logger): VercelLike {
  return {
    name: "mock-vercel",
    async deploy(ticket, input) {
      requireTicket(ticket, "vercel.deploy");
      const id = newId("dpl");
      log.info("mock vercel deploy", { target: input.target, project: input.projectName, dryRun: ticket.dryRun });
      return {
        dryRun: true,
        ok: true,
        externalId: id,
        url: `https://${input.projectName}-${id.slice(-6)}.vercel.example`,
        detail: `[MOCK/DRY-RUN] ${input.target} deploy of ${input.projectName} from ${input.sourcePath}`,
      };
    },
    async rollback(ticket, deploymentExternalId) {
      requireTicket(ticket, "vercel.rollback");
      return simulated("vercel.rollback", deploymentExternalId, "dpl");
    },
  };
}
type VercelLike = import("./types").VercelAdapter;

export function createMockGithub(): GithubAdapter {
  return {
    name: "mock-github",
    async pushBranch(ticket, input) {
      requireTicket(ticket, "github.pushBranch");
      return simulated("github.pushBranch", `${input.repo}#${input.branch}`, "gh");
    },
  };
}

export function createMockEnrichment(): EnrichmentAdapter {
  return {
    name: "mock-enrichment",
    async findContacts(ticket, domain) {
      requireTicket(ticket, "enrichment.findContacts");
      // Deterministic plausible guess so the demo pipeline has data to flow.
      return [
        { email: `info@${domain}`, name: null, role: "general inbox", confidence: 0.55, provider: "mock-enrichment" },
      ];
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
      return MOCK_BUSINESSES.filter(
        (b) => input.query === "*" || b.niche.includes(input.query.toLowerCase().replace(/\s+/g, "_")),
      ).slice(0, input.limit ?? 20);
    },
  };
}

export function createMockCalendar(): CalendarAdapter {
  return {
    name: "mock-calendar",
    async freeBusy(ticket, input) {
      requireTicket(ticket, "calendar.freeBusy");
      // Mock: busy every weekday 9:00–17:00 is FREE except a noon block.
      const from = new Date(input.fromIso);
      const busy = new Date(from);
      busy.setHours(12, 0, 0, 0);
      const busyEnd = new Date(busy);
      busyEnd.setHours(13, 0, 0, 0);
      return [{ start: busy.toISOString(), end: busyEnd.toISOString() }];
    },
  };
}

export function createMockTranscripts(): TranscriptIngestionAdapter {
  return {
    name: "mock-transcripts",
    async extractInsights(input) {
      // Naive keyword pass; replaced by an LLM-backed extractor in Phase E.
      const insights: { topic: string; insight: string }[] = [];
      for (const line of input.text.split(/\n+/)) {
        const t = line.trim();
        if (t.length > 30 && /design|layout|color|font|hero|cta|convert|mobile/i.test(t)) {
          insights.push({ topic: "design", insight: `${t.slice(0, 200)} (source: ${input.source})` });
        }
      }
      return insights;
    },
  };
}

export function createMockFirecrawl(log: Logger): FirecrawlAdapter {
  return {
    name: "mock-firecrawl",
    async scrapeCompany(ticket, url, hints) {
      requireTicket(ticket, "firecrawl.scrapeCompany");
      log.info("mock firecrawl scrapeCompany", { url, dryRun: ticket.dryRun });
      // Synthesize from audit-derived hints — no network, demo/keyless works.
      return synthesizeCompanyFacts(url, hints);
    },
  };
}

export function createMockLlm(log: Logger): LlmAdapter {
  return {
    name: "mock-llm",
    async generateBuildPrompt(ticket, input) {
      requireTicket(ticket, "llm.generateBuildPrompt");
      log.info("mock llm generateBuildPrompt", { company: input.companyName, dryRun: ticket.dryRun });
      // Pure templating — NO LLM call, so no text ever enters a real prompt.
      return templateBuildPrompt(input);
    },
    async generateOutreachCopy(ticket) {
      requireTicket(ticket, "llm.generateOutreachCopy");
      // No real LLM: signal "use your deterministic template" by returning null.
      return null;
    },
    async classifyReply(ticket) {
      requireTicket(ticket, "llm.classifyReply");
      // No real LLM: signal "keep your deterministic regex result" via null.
      return null;
    },
    async extractTranscriptInsights(ticket) {
      requireTicket(ticket, "llm.extractTranscriptInsights");
      // No real LLM: signal "use your deterministic keyword extractor" via null.
      return null;
    },
    async scoreVisualDesign(ticket) {
      requireTicket(ticket, "llm.scoreVisualDesign");
      // No real LLM: signal "score deterministically only" via null.
      return null;
    },
  };
}

export function createMockHiggsfield(log: Logger): HiggsfieldAdapter {
  return {
    name: "mock-higgsfield",
    async generateImage(ticket, input) {
      requireTicket(ticket, "higgsfield.generateImage");
      log.info("mock higgsfield generateImage", { purpose: input.purpose, dryRun: ticket.dryRun });
      return simulated("higgsfield.generateImage", `purpose=${input.purpose}`, "hf");
    },
  };
}
