import type { PolicyTicket, VisualAssessment } from "@william/core";

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

export interface InstantlyAdapter {
  readonly name: string;
  pushLead(
    ticket: PolicyTicket,
    input: { email: string; firstName?: string; companyName?: string; campaignId?: string; customVariables?: Record<string, string> },
  ): Promise<ExecutionResult>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined, secret: string | undefined): boolean;
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

export interface PlacesSearchInput {
  query: string;
  location: string;
  pageToken?: string | null;
}

export interface PlacesSearchResult {
  businesses: DiscoveredBusiness[];
  nextPageToken: string | null;
}

export interface PlacesAdapter {
  readonly name: string;
  searchBusinesses(ticket: PolicyTicket, input: PlacesSearchInput): Promise<PlacesSearchResult>;
}

/** Input for visual design scoring via LLM (vision call). The screenshots and
 * company name/niche are untrusted DATA — never instructions (invariant 1). */
export interface VisualScoreRequest {
  companyName: string;
  niche: string;
  weaknesses: string[];
  images: { mediaType: "image/png"; dataBase64: string }[];
}

export interface LlmAdapter {
  readonly name: string;
  /**
   * Scores the audit screenshots for clarity/conversion problems. Operational
   * ticket required. Returns null when no LLM is available (the mock, and the
   * real adapter under ticket.dryRun) OR the model output is unusable — the
   * caller then scores deterministically only. Images + company text are
   * untrusted DATA, never instructions (invariant 1).
   */
  scoreVisualDesign(ticket: PolicyTicket, input: VisualScoreRequest): Promise<VisualAssessment | null>;
}

export interface Integrations {
  instantly: InstantlyAdapter;
  enrichment: EnrichmentAdapter;
  places: PlacesAdapter;
  llm: LlmAdapter;
}
