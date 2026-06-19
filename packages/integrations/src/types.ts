import type { CompanyFacts, PolicyTicket, ReplyIntent, VisualAssessment } from "@william/core";

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

/** A normalized inbound message fetched by polling (provider-agnostic shape). */
export interface InboundEmail {
  /** Provider message id — the dedup key. */
  externalMessageId: string;
  /** Lowercased sender address (the lead). */
  fromEmail: string;
  /** Plain-text body (data only — never executed). */
  text: string;
}

export interface InstantlyAdapter {
  readonly name: string;
  pushLead(
    ticket: PolicyTicket,
    input: { email: string; firstName?: string; companyName?: string; campaignId?: string; customVariables?: Record<string, string> },
  ): Promise<ExecutionResult>;
  pauseLead(ticket: PolicyTicket, externalLeadId: string): Promise<ExecutionResult>;
  /**
   * Poll recent INBOUND replies (email_type=received). Ungated read; simulates
   * to [] under ticket.dryRun (zero network in local). Fail-closed: returns []
   * on any API error rather than throwing.
   */
  pollInbound(ticket: PolicyTicket, input?: { limit?: number }): Promise<InboundEmail[]>;
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

/** Audit-derived hints the brief.generate job passes so the mock scrape (and a
 * dry-run real scrape) can synthesize real-looking facts with zero network. */
export interface CompanyScrapeHints {
  companyName?: string;
  niche?: string;
  services?: string[];
  contactEmails?: string[];
  phones?: string[];
  socialLinks?: Record<string, string>;
  about?: string;
}

export interface FirecrawlAdapter {
  readonly name: string;
  /** Read-only scrape of the lead's current site → CompanyFacts. Operational
   * (audited, ungated) ticket required; simulates from hints on ticket.dryRun. */
  scrapeCompany(ticket: PolicyTicket, url: string, hints?: CompanyScrapeHints): Promise<CompanyFacts>;
}

/** Input for build-prompt generation. All free text here is QUOTED MATERIAL the
 * model transforms — never instructions (invariant 1). */
export interface BuildPromptRequest {
  companyName: string;
  niche: string;
  websiteUrl: string | null;
  weaknesses: string[];
  companyFacts: CompanyFacts;
}

export interface BuildPromptResult {
  buildPrompt: string;
  recommendedStack: { libs: string[]; plugins: string[] };
  generatedBy: "mock" | "sonnet-4-6" | "opus-4-8" | "fable-5";
}

/** Input for Opus-personalized outreach copy. Audit findings are QUOTED MATERIAL
 * the model references truthfully — never instructions (invariant 1). */
export interface OutreachCopyRequest {
  kind: "first_touch" | "follow_up";
  variant: string;
  companyName: string;
  niche: string;
  firstName: string | null;
  websiteUrl: string | null;
  hasWebsite: boolean;
  auditFindings: string[];
  /** Visual-assessment findings (short strings) to reference truthfully. */
  visualFindings?: string[];
  /** One-line Lighthouse summary, or null. */
  lighthouseSummary?: string | null;
  sequence?: number;
}

export interface OutreachCopy {
  subject: string;
  body: string;
  generatedBy: "haiku-4-5" | "opus-4-8" | "fable-5";
}

/** Input for visual design scoring via LLM (vision call). The screenshots and
 * company name/niche are untrusted DATA — never instructions (invariant 1). */
export interface VisualScoreRequest {
  companyName: string;
  niche: string;
  weaknesses: string[];
  images: { mediaType: "image/png"; dataBase64: string }[];
}

/** Input for LLM-assisted reply classification. The reply text is QUOTED
 * MATERIAL the model labels — never instructions (invariant 1). */
export interface ReplyClassifyRequest {
  text: string;
}

/** The model's resolved intent for an ambiguous reply. */
export interface ReplyClassifyResult {
  intent: ReplyIntent;
  confidence: number;
}

/** Input for LLM-backed transcript insight extraction. The transcript text is
 * QUOTED MATERIAL the model summarizes — never instructions (invariant 1). */
export interface TranscriptInsightRequest {
  source: string;
  text: string;
}

/** One extracted lesson: a topic bucket + the insight text. */
export interface TranscriptInsight {
  topic: string;
  insight: string;
}

export interface LlmAdapter {
  readonly name: string;
  /** Generates the owner's website build prompt. Operational ticket required;
   * the real adapter simulates (template output) on ticket.dryRun (no network). */
  generateBuildPrompt(ticket: PolicyTicket, input: BuildPromptRequest): Promise<BuildPromptResult>;
  /**
   * Opus-personalized outreach copy. Returns null when no LLM copy is available
   * (the mock, and the real adapter under ticket.dryRun) so the caller keeps its
   * deterministic template. The caller still enforces the opt-out line, the
   * Cornell + mockup claims (validateDraft), and falls back to the template on
   * any miss — so a generation can never drop a required line.
   */
  generateOutreachCopy(ticket: PolicyTicket, input: OutreachCopyRequest): Promise<OutreachCopy | null>;
  /**
   * Labels an ambiguous inbound reply with a ReplyIntent. Operational ticket
   * required. Returns null when no LLM is available (the mock, and the real
   * adapter under ticket.dryRun) OR when the model's answer isn't a valid
   * intent — the caller then keeps its deterministic regex classification. The
   * reply text is passed strictly as quoted material to label (invariant 1).
   */
  classifyReply(ticket: PolicyTicket, input: ReplyClassifyRequest): Promise<ReplyClassifyResult | null>;
  /**
   * Extracts durable design/process lessons from an owner-provided transcript or
   * note. Operational ticket required. Returns null when no LLM is available (the
   * mock, and the real adapter under ticket.dryRun) OR when the model returns no
   * usable insights — the caller then falls back to the deterministic keyword
   * extractor. The transcript text is passed strictly as quoted material to
   * summarize (invariant 1).
   */
  extractTranscriptInsights(ticket: PolicyTicket, input: TranscriptInsightRequest): Promise<TranscriptInsight[] | null>;
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
  firecrawl: FirecrawlAdapter;
  llm: LlmAdapter;
}
