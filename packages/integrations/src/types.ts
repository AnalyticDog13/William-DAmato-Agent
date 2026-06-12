import type { PolicyTicket } from "@william/core";

/**
 * Every adapter method that touches the outside world REQUIRES a PolicyTicket
 * (issued only by the PolicyEngine) and MUST honor ticket.dryRun by simulating.
 * The result always reports whether the action really happened.
 */
export interface ExecutionResult {
  dryRun: boolean;
  ok: boolean;
  externalId?: string;
  url?: string;
  detail: string;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  /** Mandatory opt-out line; adapters refuse emails without it. */
  optOutLine: string;
}

export interface EmailAdapter {
  readonly name: string;
  send(ticket: PolicyTicket, email: OutboundEmail): Promise<ExecutionResult>;
}

export interface InstantlyAdapter {
  readonly name: string;
  pushLead(
    ticket: PolicyTicket,
    input: { email: string; firstName?: string; companyName?: string; campaignId?: string; customVariables?: Record<string, string> },
  ): Promise<ExecutionResult>;
  pauseLead(ticket: PolicyTicket, externalLeadId: string): Promise<ExecutionResult>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined, secret: string | undefined): boolean;
}

export interface StripeAdapter {
  readonly name: string;
  createPaymentLink(
    ticket: PolicyTicket,
    /** metadata is copied onto Checkout Sessions — set invoiceDraftId so the webhook can match payments. */
    input: { description: string; amountUsd: number; metadata?: Record<string, string> },
  ): Promise<ExecutionResult>;
  createInvoiceDraft(
    ticket: PolicyTicket,
    input: { customerEmail: string; description: string; amountUsd: number; metadata?: Record<string, string> },
  ): Promise<ExecutionResult>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined, secret: string | undefined): boolean;
}

export interface VercelAdapter {
  readonly name: string;
  deploy(
    ticket: PolicyTicket,
    input: { target: "preview" | "production"; projectName: string; sourcePath: string; branch?: string },
  ): Promise<ExecutionResult>;
  rollback(ticket: PolicyTicket, deploymentExternalId: string): Promise<ExecutionResult>;
}

export interface GithubAdapter {
  readonly name: string;
  pushBranch(
    ticket: PolicyTicket,
    input: { repo: string; branch: string; message: string },
  ): Promise<ExecutionResult>;
}

export interface EnrichedContact {
  email: string;
  name: string | null;
  role: string | null;
  confidence: number;
  provider: string;
}

export interface EnrichmentAdapter {
  readonly name: string;
  /** Read-only external lookup — still requires an OPERATIONAL ticket. */
  findContacts(ticket: PolicyTicket, domain: string): Promise<EnrichedContact[]>;
  verifyEmail(ticket: PolicyTicket, email: string): Promise<{ status: "valid" | "risky" | "invalid"; detail: string }>;
}

export interface DiscoveredBusiness {
  name: string;
  niche: string;
  websiteUrl: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  rating: number | null;
}

export interface PlacesAdapter {
  readonly name: string;
  searchBusinesses(
    ticket: PolicyTicket,
    input: { query: string; location: string; limit?: number },
  ): Promise<DiscoveredBusiness[]>;
}

export interface CalendarAdapter {
  readonly name: string;
  freeBusy(
    ticket: PolicyTicket,
    input: { fromIso: string; toIso: string },
  ): Promise<{ start: string; end: string }[]>;
}

export interface TranscriptIngestionAdapter {
  readonly name: string;
  /** Extracts design lessons from owner-provided transcripts/notes/repos. Local-only, no ticket needed. */
  extractInsights(input: { source: string; text: string }): Promise<{ topic: string; insight: string }[]>;
}

export interface HiggsfieldAdapter {
  readonly name: string;
  generateImage(
    ticket: PolicyTicket,
    input: { prompt: string; purpose: string },
  ): Promise<ExecutionResult>;
}

export interface Integrations {
  email: EmailAdapter;
  instantly: InstantlyAdapter;
  stripe: StripeAdapter;
  vercel: VercelAdapter;
  github: GithubAdapter;
  enrichment: EnrichmentAdapter;
  places: PlacesAdapter;
  calendar: CalendarAdapter;
  transcripts: TranscriptIngestionAdapter;
  higgsfield: HiggsfieldAdapter;
}
