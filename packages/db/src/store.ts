import {
  ActivityEvent,
  ApprovalRequest,
  AuditLogEntry,
  BookingRecord,
  CallSuggestion,
  CampaignSync,
  Company,
  ComplianceEvent,
  Contact,
  DailyMemory,
  DeploymentRecord,
  DoNotContactRecord,
  DurableLesson,
  Experiment,
  ExperimentResult,
  FailureLog,
  GatePolicy,
  IntegrationCredentialStatus,
  InvoiceDraft,
  Lead,
  LeadScore,
  Opportunity,
  OutreachDraft,
  OwnerRequest,
  PaymentRecord,
  ReplyEvent,
  SiteProject,
  SiteRevision,
  UnsubscribeRecord,
  WebhookEventRecord,
  WebsiteAudit,
  WeeklyReport,
  newId,
  nowIso,
} from "@william/core";
import { z } from "zod";
import type { Db } from "./database";
import { JobQueue } from "./queue";
import { Repository } from "./repository";

/** GatePolicy persisted with an id (gate name doubles as the id). */
const StoredGatePolicy = GatePolicy.extend({
  id: z.string(),
  createdAt: z.string(),
});

export type StoredGatePolicy = z.infer<typeof StoredGatePolicy>;

/**
 * Central data access object. One Store per process; everything (workers, API)
 * reads and writes through it so indexing and validation stay consistent.
 */
export class Store {
  readonly leads: Repository<Lead>;
  readonly companies: Repository<Company>;
  readonly contacts: Repository<Contact>;
  readonly audits: Repository<WebsiteAudit>;
  readonly leadScores: Repository<LeadScore>;
  readonly outreachDrafts: Repository<OutreachDraft>;
  readonly campaignSyncs: Repository<CampaignSync>;
  readonly replyEvents: Repository<ReplyEvent>;
  readonly opportunities: Repository<Opportunity>;
  readonly siteProjects: Repository<SiteProject>;
  readonly siteRevisions: Repository<SiteRevision>;
  readonly approvals: Repository<ApprovalRequest>;
  readonly deployments: Repository<DeploymentRecord>;
  readonly invoiceDrafts: Repository<InvoiceDraft>;
  readonly payments: Repository<PaymentRecord>;
  readonly callSuggestions: Repository<CallSuggestion>;
  readonly bookings: Repository<BookingRecord>;
  readonly failures: Repository<FailureLog>;
  readonly experiments: Repository<Experiment>;
  readonly experimentResults: Repository<ExperimentResult>;
  readonly dailyMemories: Repository<DailyMemory>;
  readonly weeklyReports: Repository<WeeklyReport>;
  readonly lessons: Repository<DurableLesson>;
  readonly ownerRequests: Repository<OwnerRequest>;
  readonly credentialStatuses: Repository<IntegrationCredentialStatus>;
  readonly complianceEvents: Repository<ComplianceEvent>;
  readonly unsubscribes: Repository<UnsubscribeRecord>;
  readonly doNotContact: Repository<DoNotContactRecord>;
  readonly auditLog: Repository<AuditLogEntry>;
  readonly webhookEvents: Repository<WebhookEventRecord>;
  readonly activity: Repository<ActivityEvent>;
  readonly gatePolicies: Repository<StoredGatePolicy>;
  readonly queue: JobQueue;

  constructor(readonly db: Db) {
    const repo = <T extends { id: string; createdAt: string; updatedAt: string }>(
      cfg: ConstructorParameters<typeof Repository<T>>[1],
    ) => new Repository<T>(db, cfg);

    this.leads = repo<Lead>({
      collection: "leads",
      schema: Lead,
      leadId: (l) => l.id,
      status: (l) => l.status,
      skey: (l) => l.niche,
      keys: (l) => l.identityKeys,
    });
    this.companies = repo<Company>({
      collection: "companies",
      schema: Company,
      skey: (c) => c.niche,
      keys: (c) => [`company:${c.identityKey}`],
    });
    this.contacts = repo<Contact>({
      collection: "contacts",
      schema: Contact,
      leadId: (c) => c.leadId,
      status: (c) => c.verification,
      keys: (c) => (c.email ? [`email:${c.email}`] : []),
    });
    this.audits = repo<WebsiteAudit>({
      collection: "website_audits",
      schema: WebsiteAudit,
      leadId: (a) => a.leadId,
      status: (a) => a.mode,
    });
    this.leadScores = repo<LeadScore>({
      collection: "lead_scores",
      schema: LeadScore,
      leadId: (s) => s.leadId,
      status: (s) => s.tier,
    });
    this.outreachDrafts = repo<OutreachDraft>({
      collection: "outreach_drafts",
      schema: OutreachDraft,
      leadId: (d) => d.leadId,
      status: (d) => d.status,
      skey: (d) => d.variant,
    });
    this.campaignSyncs = repo<CampaignSync>({
      collection: "campaign_syncs",
      schema: CampaignSync,
      leadId: (c) => c.leadId,
      status: (c) => c.status,
    });
    this.replyEvents = repo<ReplyEvent>({
      collection: "reply_events",
      schema: ReplyEvent,
      leadId: (r) => r.leadId,
      status: (r) => r.intent,
    });
    this.opportunities = repo<Opportunity>({
      collection: "opportunities",
      schema: Opportunity,
      leadId: (o) => o.leadId,
      status: (o) => o.stage,
    });
    this.siteProjects = repo<SiteProject>({
      collection: "site_projects",
      schema: SiteProject,
      leadId: (s) => s.leadId,
      status: (s) => s.status,
      skey: (s) => s.templateId,
    });
    this.siteRevisions = repo<SiteRevision>({
      collection: "site_revisions",
      schema: SiteRevision,
      status: (r) => r.status,
      skey: (r) => r.siteProjectId,
    });
    this.approvals = repo<ApprovalRequest>({
      collection: "approval_requests",
      schema: ApprovalRequest,
      leadId: (a) => a.leadId,
      status: (a) => a.status,
      skey: (a) => a.gate,
      keys: (a) => [`subject:${a.gate}:${a.subjectId}`],
    });
    this.deployments = repo<DeploymentRecord>({
      collection: "deployments",
      schema: DeploymentRecord,
      status: (d) => d.status,
      skey: (d) => d.target,
    });
    this.invoiceDrafts = repo<InvoiceDraft>({
      collection: "invoice_drafts",
      schema: InvoiceDraft,
      leadId: (i) => i.leadId,
      status: (i) => i.status,
    });
    this.payments = repo<PaymentRecord>({
      collection: "payments",
      schema: PaymentRecord,
      leadId: (p) => p.leadId,
      status: (p) => p.status,
    });
    this.callSuggestions = repo<CallSuggestion>({
      collection: "call_suggestions",
      schema: CallSuggestion,
      leadId: (c) => c.leadId,
      status: (c) => c.status,
    });
    this.bookings = repo<BookingRecord>({
      collection: "bookings",
      schema: BookingRecord,
      leadId: (b) => b.leadId,
      status: (b) => b.outcome,
    });
    this.failures = repo<FailureLog>({
      collection: "failure_logs",
      schema: FailureLog,
      leadId: (f) => f.leadId,
      status: (f) => f.category,
      skey: (f) => f.traceId,
    });
    this.experiments = repo<Experiment>({
      collection: "experiments",
      schema: Experiment,
      status: (e) => e.status,
      skey: (e) => e.dimension,
    });
    this.experimentResults = repo<ExperimentResult>({
      collection: "experiment_results",
      schema: ExperimentResult,
      skey: (r) => r.experimentId,
    });
    this.dailyMemories = repo<DailyMemory>({
      collection: "daily_memories",
      schema: DailyMemory,
      skey: (m) => m.date,
    });
    this.weeklyReports = repo<WeeklyReport>({
      collection: "weekly_reports",
      schema: WeeklyReport,
      skey: (r) => r.weekStart,
    });
    this.lessons = repo<DurableLesson>({
      collection: "durable_lessons",
      schema: DurableLesson,
      skey: (l) => l.topic,
    });
    this.ownerRequests = repo<OwnerRequest>({
      collection: "owner_requests",
      schema: OwnerRequest,
      status: (r) => r.status,
      skey: (r) => r.category,
    });
    this.credentialStatuses = repo<IntegrationCredentialStatus>({
      collection: "credential_statuses",
      schema: IntegrationCredentialStatus,
      status: (c) => c.mode,
      keys: (c) => [`integration:${c.integration}`],
    });
    this.complianceEvents = repo<ComplianceEvent>({
      collection: "compliance_events",
      schema: ComplianceEvent,
      leadId: (c) => c.leadId,
      status: (c) => c.kind,
    });
    this.unsubscribes = repo<UnsubscribeRecord>({
      collection: "unsubscribes",
      schema: UnsubscribeRecord,
      leadId: (u) => u.leadId,
      keys: (u) => [`email:${u.email}`],
    });
    this.doNotContact = repo<DoNotContactRecord>({
      collection: "do_not_contact",
      schema: DoNotContactRecord,
      keys: (d) => [d.identityKey],
    });
    this.auditLog = repo<AuditLogEntry>({
      collection: "audit_log",
      schema: AuditLogEntry,
      leadId: (a) => a.leadId,
      status: (a) => a.outcome,
      skey: (a) => a.traceId,
    });
    this.webhookEvents = repo<WebhookEventRecord>({
      collection: "webhook_events",
      schema: WebhookEventRecord,
      status: (w) => w.provider,
      skey: (w) => w.eventType,
    });
    this.activity = repo<ActivityEvent>({
      collection: "activity_events",
      schema: ActivityEvent,
      leadId: (a) => a.leadId,
      skey: (a) => a.kind,
    });
    this.gatePolicies = repo<StoredGatePolicy>({
      collection: "gate_policies",
      schema: StoredGatePolicy,
      skey: (g) => g.gate,
    });
    this.queue = new JobQueue(db);
  }

  /** Append an audit-log entry (the PolicyEngine sink and manual use). */
  writeAudit(entry: Omit<AuditLogEntry, "id" | "createdAt" | "updatedAt">): AuditLogEntry {
    const now = nowIso();
    return this.auditLog.insert({ ...entry, id: newId("aud"), createdAt: now, updatedAt: now });
  }

  writeActivity(
    leadId: string,
    kind: string,
    message: string,
    opts: { traceId?: string | null; byApproval?: boolean; data?: Record<string, unknown> } = {},
  ): ActivityEvent {
    const now = nowIso();
    return this.activity.insert({
      id: newId("act"),
      createdAt: now,
      updatedAt: now,
      leadId,
      traceId: opts.traceId ?? null,
      kind,
      message,
      byApproval: opts.byApproval ?? false,
      data: opts.data ?? {},
    });
  }

  writeCompliance(
    kind: ComplianceEvent["kind"],
    detail: string,
    opts: { leadId?: string | null; traceId?: string | null } = {},
  ): ComplianceEvent {
    const now = nowIso();
    return this.complianceEvents.insert({
      id: newId("cmp"),
      createdAt: now,
      updatedAt: now,
      kind,
      detail,
      leadId: opts.leadId ?? null,
      traceId: opts.traceId ?? null,
    });
  }

  /** Gate policy with safe default (approval mode) when owner has not configured it. */
  getGatePolicy(gate: GatePolicy["gate"]): StoredGatePolicy {
    const existing = this.gatePolicies.list({ skey: gate, limit: 1 })[0];
    if (existing) return existing;
    const now = nowIso();
    return {
      id: gate,
      gate,
      mode: "approval",
      note: "default (not configured by owner)",
      createdAt: now,
      updatedAt: now,
    };
  }

  setGatePolicy(gate: GatePolicy["gate"], mode: GatePolicy["mode"], note: string): StoredGatePolicy {
    const now = nowIso();
    const existing = this.gatePolicies.list({ skey: gate, limit: 1 })[0];
    const next: StoredGatePolicy = existing
      ? { ...existing, mode, note, updatedAt: now }
      : { id: gate, gate, mode, note, createdAt: now, updatedAt: now };
    return this.gatePolicies.save(next);
  }
}
