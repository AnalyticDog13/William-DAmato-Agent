import { existsSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import express, { type Express, type Request } from "express";
import { Experiment, GATE_DEFINITIONS, Niche, PolicyGateName, newId, newTraceId, nowIso } from "@william/core";
import type { Repository } from "@william/db";
import {
  computeExperimentResults,
  computeMetrics,
  decideApproval,
  generateDailyReport,
  generateWeeklyReport,
  ingestLead,
  requestApproval,
  runUntilEmpty,
  seedDemoData,
  type AppContext,
} from "@william/worker-orchestrator";
import { FIRST_TOUCH_VARIANTS } from "@william/worker-outreach";
import { requireOwner, resolveOwnerToken } from "./auth";
import { cors, rateLimit, securityHeaders } from "./security";
import { webhookRoutes } from "./webhooks";

/** Returned by the builder routes when WILLIAM_BUILDS_WEBSITES is off (the default). */
const BUILDER_DISABLED_DETAIL =
  "William's website builder is disabled (WILLIAM_BUILDS_WEBSITES=false). William generates a WebsiteBrief for the owner to build, then ships the owner's finished repo. Set WILLIAM_BUILDS_WEBSITES=true to re-enable the self-builder.";

/** Collections the dashboard may list. Server-side whitelist — no dynamic table access. */
function collections(ctx: AppContext): Record<string, Repository<any>> {
  const s = ctx.store;
  return {
    leads: s.leads,
    companies: s.companies,
    contacts: s.contacts,
    audits: s.audits,
    "lead-scores": s.leadScores,
    "outreach-drafts": s.outreachDrafts,
    "campaign-syncs": s.campaignSyncs,
    replies: s.replyEvents,
    opportunities: s.opportunities,
    "site-projects": s.siteProjects,
    "site-revisions": s.siteRevisions,
    "website-briefs": s.websiteBriefs,
    "sourcing-runs": s.sourcingRuns,
    approvals: s.approvals,
    deployments: s.deployments,
    "invoice-drafts": s.invoiceDrafts,
    payments: s.payments,
    "call-suggestions": s.callSuggestions,
    bookings: s.bookings,
    failures: s.failures,
    experiments: s.experiments,
    "experiment-results": s.experimentResults,
    "daily-memories": s.dailyMemories,
    "weekly-reports": s.weeklyReports,
    lessons: s.lessons,
    "owner-requests": s.ownerRequests,
    integrations: s.credentialStatuses,
    "compliance-events": s.complianceEvents,
    unsubscribes: s.unsubscribes,
    "do-not-contact": s.doNotContact,
    "audit-log": s.auditLog,
    "webhook-events": s.webhookEvents,
    activity: s.activity,
  };
}

/** In local env the API doubles as an inline worker so the demo needs one process. */
async function kickQueue(ctx: AppContext): Promise<void> {
  if (ctx.config.env === "local") await runUntilEmpty(ctx, 200);
}

export function createServer(ctx: AppContext): Express {
  const app = express();
  const token = resolveOwnerToken(ctx);
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(cors(ctx.config.dashboardOrigin));

  // Public endpoints (rate-limited): health + webhooks (signature-verified).
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, env: ctx.config.env, dryRun: ctx.config.dryRun });
  });
  app.use("/webhooks", rateLimit({ windowMs: 60_000, max: 120 }), webhookRoutes(ctx));

  // Everything below is owner-only, enforced server-side.
  const api = express.Router();
  app.use("/api", rateLimit({ windowMs: 60_000, max: 600 }), requireOwner(token), api);
  api.use(express.json({ limit: "1mb" }));

  api.get("/overview", (_req, res) => {
    const metrics = computeMetrics(ctx);
    res.json({
      metrics,
      env: ctx.config.env,
      dryRun: ctx.config.dryRun,
      williamBuildsWebsites: ctx.config.williamBuildsWebsites,
      pendingApprovals: ctx.store.approvals.list({ status: "pending", limit: 10 }),
      openOwnerRequests: ctx.store.ownerRequests.list({ status: "open", limit: 10 }),
      recentActivity: ctx.store.activity.list({ limit: 20 }),
    });
  });

  api.get("/collections/:name", (req, res) => {
    const repo = collections(ctx)[req.params.name];
    if (!repo) {
      res.status(404).json({ error: "unknown_collection" });
      return;
    }
    const q = req.query as Record<string, string | undefined>;
    const items = repo.list({
      search: q.search,
      status: q.status,
      leadId: q.leadId,
      skey: q.skey,
      limit: q.limit ? Number(q.limit) : 100,
      offset: q.offset ? Number(q.offset) : 0,
    });
    res.json({ items, total: repo.count({ status: q.status, leadId: q.leadId }) });
  });

  api.get("/leads/:id/timeline", (req, res) => {
    const lead = ctx.store.leads.get(req.params.id!);
    if (!lead) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const siteProjects = ctx.store.siteProjects.list({ leadId: lead.id });
    const projectIds = new Set(siteProjects.map((p) => p.id));
    res.json({
      lead,
      company: ctx.store.companies.get(lead.companyId),
      contacts: ctx.store.contacts.list({ leadId: lead.id }),
      audits: ctx.store.audits.list({ leadId: lead.id }),
      scores: ctx.store.leadScores.list({ leadId: lead.id }),
      drafts: ctx.store.outreachDrafts.list({ leadId: lead.id }),
      replies: ctx.store.replyEvents.list({ leadId: lead.id }),
      opportunities: ctx.store.opportunities.list({ leadId: lead.id }),
      siteProjects,
      siteRevisions: ctx.store.siteRevisions.list({ limit: 200 }).filter((r) => projectIds.has(r.siteProjectId)),
      deployments: ctx.store.deployments.list({ limit: 200 }).filter((d) => d.siteProjectId !== null && projectIds.has(d.siteProjectId)),
      invoices: ctx.store.invoiceDrafts.list({ leadId: lead.id }),
      callSuggestions: ctx.store.callSuggestions.list({ leadId: lead.id }),
      activity: ctx.store.activity.list({ leadId: lead.id, limit: 200, order: "asc" }),
    });
  });

  api.post("/leads", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const niche = Niche.safeParse(body.niche);
    if (typeof body.companyName !== "string" || !body.companyName.trim() || !niche.success) {
      res.status(400).json({ error: "companyName and valid niche are required" });
      return;
    }
    const result = ingestLead(ctx, {
      companyName: body.companyName,
      websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : null,
      niche: niche.data,
      city: typeof body.city === "string" ? body.city : null,
      email: typeof body.email === "string" ? body.email : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      source: { kind: "manual", detail: "dashboard", importedAt: nowIso(), importedBy: "owner" },
    });
    await kickQueue(ctx);
    res.status(result.outcome === "created" ? 201 : 409).json(result);
  });

  // Review queue: pending approvals with one-click decisions.
  api.get("/review-queue", (_req, res) => {
    res.json({ items: ctx.store.approvals.list({ status: "pending", limit: 100, order: "asc" }) });
  });

  api.post("/approvals/:id/decide", async (req, res) => {
    const { decision, note } = req.body as { decision?: string; note?: string };
    if (decision !== "granted" && decision !== "rejected") {
      res.status(400).json({ error: "decision must be granted|rejected" });
      return;
    }
    try {
      const approval = decideApproval(ctx, req.params.id!, decision, note ?? "");
      if (decision === "granted") {
        // Gate-specific follow-through jobs.
        if (approval.gate === "SEND_FIRST_TOUCH") {
          ctx.store.queue.enqueue({ type: "outreach.send", payload: { draftId: approval.subjectId }, traceId: approval.traceId, leadId: approval.leadId });
        } else if (approval.gate === "SEND_PAYMENT_REQUEST") {
          ctx.store.queue.enqueue({ type: "billing.execute", payload: { invoiceDraftId: approval.subjectId }, traceId: approval.traceId, leadId: approval.leadId });
        } else if (approval.gate === "ACTIVATE_NEW_LEAD_SOURCE") {
          const run = ctx.store.sourcingRuns.get(approval.subjectId);
          if (run) {
            ctx.store.sourcingRuns.save({ ...run, status: "running", updatedAt: nowIso() });
            ctx.store.queue.enqueue({ type: "lead.source", payload: { sourcingRunId: run.id }, traceId: approval.traceId });
          }
        } else if (approval.gate === "DEPLOY_PRODUCTION") {
          // Same gate, two paths: ship the owner's repo (business head) vs
          // deploy William's own artifact (builder re-enabled).
          if (approval.subjectType === "WebsiteBrief") {
            ctx.store.queue.enqueue({ type: "site.ship", payload: { websiteBriefId: approval.subjectId, approvalRequestId: approval.id }, traceId: approval.traceId, leadId: approval.leadId });
          } else {
            ctx.store.queue.enqueue({ type: "deploy.production", payload: { siteProjectId: approval.subjectId, approvalRequestId: approval.id }, traceId: approval.traceId, leadId: approval.leadId });
          }
        }
      } else if (decision === "rejected" && approval.gate === "SEND_FIRST_TOUCH") {
        // Rejecting an email draft marks the DRAFT itself "rejected" (not just the
        // approval) so it leaves the pending state and reads correctly in the UI.
        const draft = ctx.store.outreachDrafts.get(approval.subjectId);
        if (draft) ctx.store.outreachDrafts.save({ ...draft, status: "rejected", updatedAt: nowIso() });
      }
      await kickQueue(ctx);
      res.json({ approval });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : "decide_failed" });
    }
  });

  // Revision loop: owner submits a change request; structured overrides are
  // applied by the site.revise job, free text alone is rejected with guidance.
  api.post("/site-projects/:id/revisions", async (req, res) => {
    const project = ctx.store.siteProjects.get(req.params.id!);
    if (!project) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!ctx.config.williamBuildsWebsites) {
      res.status(403).json({ error: "builder_disabled", detail: BUILDER_DISABLED_DETAIL });
      return;
    }
    const body = req.body as { request?: unknown; overrides?: unknown };
    if (typeof body.request !== "string" || !body.request.trim()) {
      res.status(400).json({ error: "request text is required" });
      return;
    }
    const overrides =
      body.overrides && typeof body.overrides === "object" && !Array.isArray(body.overrides)
        ? (body.overrides as Record<string, unknown>)
        : {};
    const now = nowIso();
    const revision = ctx.store.siteRevisions.insert({
      id: newId("rev"),
      createdAt: now,
      updatedAt: now,
      siteProjectId: project.id,
      requestedBy: "owner",
      request: body.request.trim(),
      overrides,
      status: "pending",
      resultNote: "",
    });
    ctx.store.siteProjects.save({ ...project, status: "revisions", updatedAt: now });
    const traceId = newTraceId();
    ctx.store.queue.enqueue({ type: "site.revise", payload: { revisionId: revision.id }, traceId, leadId: project.leadId });
    await kickQueue(ctx);
    res.status(201).json({ revision: ctx.store.siteRevisions.get(revision.id) });
  });

  // Owner approves the preview for the customer → DEPLOY_PRODUCTION approval
  // request. Quality gate first; the granted approval enqueues deploy.production.
  api.post("/site-projects/:id/request-deploy", (req, res) => {
    const project = ctx.store.siteProjects.get(req.params.id!);
    if (!project) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!ctx.config.williamBuildsWebsites) {
      res.status(403).json({ error: "builder_disabled", detail: BUILDER_DISABLED_DETAIL });
      return;
    }
    if (!project.previewPath && !project.buildPath) {
      res.status(409).json({ error: "no_artifact", detail: "Project has no preview or build to deploy" });
      return;
    }
    if (project.qualityCheck && (project.qualityCheck.lighthousePassed === false || project.qualityCheck.a11yPassed === false)) {
      res.status(409).json({ error: "quality_failed", detail: "Preview failed its quality check — revise before requesting a deploy" });
      return;
    }
    const lead = ctx.store.leads.get(project.leadId);
    const company = lead ? ctx.store.companies.get(lead.companyId) : null;
    const approval = requestApproval(ctx, {
      gate: "DEPLOY_PRODUCTION",
      subjectType: "SiteProject",
      subjectId: project.id,
      leadId: project.leadId,
      title: `Deploy ${company?.name ?? project.leadId} site to production`,
      detail: `Template ${project.templateId} (${project.stack} stack). ${project.qualityCheck ? "Quality check passed." : "No quality check ran (mock/http auditor mode)."}`,
      traceId: newTraceId(),
    });
    ctx.store.siteProjects.save({ ...project, status: "approved_for_customer", updatedAt: nowIso() });
    res.status(201).json({ approval });
  });

  // Owner-triggered preview deploy (operational; production has its own gate).
  // Auto-deploys were removed deliberately — compliance advisory D4.
  api.post("/site-projects/:id/deploy-preview", async (req, res) => {
    const project = ctx.store.siteProjects.get(req.params.id!);
    if (!project) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!ctx.config.williamBuildsWebsites) {
      res.status(403).json({ error: "builder_disabled", detail: BUILDER_DISABLED_DETAIL });
      return;
    }
    if (!project.previewPath && !project.buildPath) {
      res.status(409).json({ error: "no_artifact", detail: "Project has no preview or build to deploy" });
      return;
    }
    const job = ctx.store.queue.enqueue({
      type: "deploy.preview",
      payload: { siteProjectId: project.id },
      traceId: newTraceId(),
      leadId: project.leadId,
    });
    await kickQueue(ctx);
    res.status(202).json({ jobId: job.id });
  });

  // Business head: owner marks a WebsiteBrief's site ready + pastes the repo URL.
  // Records the repo and opens a DEPLOY_PRODUCTION approval; granting it ships
  // (site.ship) the owner's repo. No GitHub webhook — dashboard action only.
  api.post("/website-briefs/:id/ship", (req, res) => {
    const brief = ctx.store.websiteBriefs.get(req.params.id!);
    if (!brief) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const repoUrl = (req.body as { repoUrl?: unknown }).repoUrl;
    if (typeof repoUrl !== "string" || !/^https?:\/\/\S+$/.test(repoUrl.trim())) {
      res.status(400).json({ error: "a valid repoUrl (http/https) is required" });
      return;
    }
    if (brief.status === "shipped") {
      res.status(409).json({ error: "already_shipped" });
      return;
    }
    ctx.store.websiteBriefs.save({ ...brief, repoUrl: repoUrl.trim() });
    const lead = ctx.store.leads.get(brief.leadId);
    const company = lead ? ctx.store.companies.get(lead.companyId) : null;
    const approval = requestApproval(ctx, {
      gate: "DEPLOY_PRODUCTION",
      subjectType: "WebsiteBrief",
      subjectId: brief.id,
      leadId: brief.leadId,
      title: `Ship ${company?.name ?? brief.leadId} site to production`,
      detail: `Owner-built repo: ${repoUrl.trim()}`,
      traceId: newTraceId(),
    });
    res.status(201).json({ approval });
  });

  // Sourcing runs: owner triggers a one-click batch lead-sourcing session.
  // POST creates a SourcingRun (pending_approval) + ACTIVATE_NEW_LEAD_SOURCE approval.
  // Granting that approval sets the run to "running" and enqueues lead.source.
  api.post("/sourcing-runs", (req, res) => {
    const body = req.body ?? {};
    const niche = Niche.safeParse(body.niche);
    const target = Number(body.target);
    const location = typeof body.location === "string" ? body.location.trim() : "";
    if (!niche.success || !location || !Number.isInteger(target) || target <= 0) {
      res.status(400).json({ error: "location, valid niche, and positive integer target required" });
      return;
    }
    const candidateCap =
      Number.isInteger(body.candidateCap) && body.candidateCap > 0
        ? (body.candidateCap as number)
        : ctx.config.leadSourcing.defaultCandidateCap;
    const now = nowIso();
    const traceId = newTraceId();
    const run = ctx.store.sourcingRuns.insert({
      id: newId("src"),
      createdAt: now,
      updatedAt: now,
      location,
      niche: niche.data,
      target,
      candidateCap,
      status: "pending_approval",
      candidatesIngested: 0,
      qualifiedCount: 0,
      leadIds: [],
      nextPageToken: null,
      checks: 0,
      approvalRequestId: null,
      resultNote: null,
      traceId,
    });
    const approval = requestApproval(ctx, {
      gate: "ACTIVATE_NEW_LEAD_SOURCE",
      subjectType: "SourcingRun",
      subjectId: run.id,
      leadId: null,
      title: `Source ${target} ${niche.data} lead(s) in ${location}`,
      detail: `Google Places sourcing run. Candidate cap ${candidateCap}.`,
      traceId,
    });
    ctx.store.sourcingRuns.save({ ...run, approvalRequestId: approval.id });
    res.status(201).json({ run: { ...run, approvalRequestId: approval.id }, approval });
  });

  api.get("/sourcing-runs", (_req, res) => {
    res.json(ctx.store.sourcingRuns.list({ limit: 100 }));
  });

  api.get("/policies", (_req, res) => {
    const gates = Object.values(GATE_DEFINITIONS).map((def) => ({
      ...def,
      policy: ctx.store.getGatePolicy(def.gate),
    }));
    res.json({ gates, env: ctx.config.env, dryRun: ctx.config.dryRun });
  });

  api.post("/policies/:gate", (req, res) => {
    const gate = PolicyGateName.safeParse(req.params.gate);
    const mode = (req.body as { mode?: string }).mode;
    const note = String((req.body as { note?: string }).note ?? "");
    if (!gate.success || !["closed", "approval", "autopilot"].includes(mode ?? "")) {
      res.status(400).json({ error: "valid gate and mode (closed|approval|autopilot) required" });
      return;
    }
    const policy = ctx.store.setGatePolicy(gate.data, mode as "closed" | "approval" | "autopilot", note);
    ctx.store.writeAudit({
      traceId: newTraceId(),
      actor: "owner",
      action: `policy.set:${gate.data}=${mode}`,
      subjectType: "GatePolicy",
      subjectId: gate.data,
      leadId: null,
      gate: gate.data,
      outcome: "recorded",
      detail: note,
    });
    res.json({ policy });
  });

  api.post("/owner-requests/:id/status", (req, res) => {
    const request = ctx.store.ownerRequests.get(req.params.id!);
    const status = (req.body as { status?: string }).status;
    if (!request || !["open", "in_progress", "fulfilled", "dismissed"].includes(status ?? "")) {
      res.status(400).json({ error: "valid request id and status required" });
      return;
    }
    const note = String((req.body as { note?: string }).note ?? "");
    res.json({
      request: ctx.store.ownerRequests.save({ ...request, status: status as never, resolvedNote: note }),
    });
  });

  // Experiment lifecycle. Variant assignment itself happens in the draft
  // pipeline (deterministic per lead) — these routes only manage the records.
  api.post("/experiments", (req, res) => {
    const body = req.body as { name?: unknown; hypothesis?: unknown; dimension?: unknown; variants?: unknown };
    const dimension = Experiment.shape.dimension.safeParse(body.dimension);
    const variants = Array.isArray(body.variants) ? body.variants.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
    if (
      typeof body.name !== "string" || !body.name.trim() ||
      typeof body.hypothesis !== "string" || !body.hypothesis.trim() ||
      !dimension.success || variants.length < 2
    ) {
      res.status(400).json({ error: "name, hypothesis, valid dimension, and >=2 variants required" });
      return;
    }
    if (dimension.data === "outreach_variant") {
      const unknown = variants.filter((v) => !(FIRST_TOUCH_VARIANTS as readonly string[]).includes(v));
      if (unknown.length > 0) {
        res.status(400).json({ error: `unknown outreach variants: ${unknown.join(", ")} (registered: ${FIRST_TOUCH_VARIANTS.join(", ")})` });
        return;
      }
    }
    const now = nowIso();
    const experiment = ctx.store.experiments.insert({
      id: newId("exp"),
      createdAt: now,
      updatedAt: now,
      name: body.name.trim(),
      hypothesis: body.hypothesis.trim(),
      dimension: dimension.data,
      variants,
      status: "running",
      conclusion: "",
    });
    ctx.store.writeAudit({
      traceId: newTraceId(),
      actor: "owner",
      action: "experiment.created",
      subjectType: "Experiment",
      subjectId: experiment.id,
      leadId: null,
      gate: null,
      outcome: "recorded",
      detail: `${experiment.name} [${experiment.variants.join(" vs ")}]`,
    });
    res.status(201).json({ experiment });
  });

  api.post("/experiments/:id/compute", (req, res) => {
    const experiment = ctx.store.experiments.get(req.params.id!);
    if (!experiment) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ results: computeExperimentResults(ctx, experiment) });
  });

  api.post("/experiments/:id/conclude", (req, res) => {
    const experiment = ctx.store.experiments.get(req.params.id!);
    const { status, conclusion } = req.body as { status?: string; conclusion?: string };
    if (!experiment) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if ((status !== "concluded" && status !== "abandoned") || typeof conclusion !== "string" || !conclusion.trim()) {
      res.status(400).json({ error: "status (concluded|abandoned) and conclusion text required" });
      return;
    }
    const results = computeExperimentResults(ctx, experiment); // final snapshot
    const saved = ctx.store.experiments.save({ ...experiment, status, conclusion: conclusion.trim() });
    ctx.store.writeAudit({
      traceId: newTraceId(),
      actor: "owner",
      action: `experiment.${status}`,
      subjectType: "Experiment",
      subjectId: saved.id,
      leadId: null,
      gate: null,
      outcome: "recorded",
      detail: conclusion.trim(),
    });
    res.json({ experiment: saved, results });
  });

  // Owner-provided transcripts/notes/design references → durable lessons.
  // Transcript text is DATA (invariant 1): scanned and stored, never executed.
  api.post("/transcripts", async (req, res) => {
    const { source, text } = req.body as { source?: unknown; text?: unknown };
    if (
      typeof source !== "string" || !source.trim() ||
      typeof text !== "string" || !text.trim() || text.length > 100_000
    ) {
      res.status(400).json({ error: "source and text (1–100k chars) required" });
      return;
    }
    const job = ctx.store.queue.enqueue({
      type: "ingest.transcript",
      payload: { source: source.trim(), text },
      traceId: newTraceId(),
    });
    await kickQueue(ctx);
    res.status(202).json({ jobId: job.id });
  });

  api.get("/jobs", (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json({ items: ctx.store.queue.list({ status: q.status, limit: q.limit ? Number(q.limit) : 200 }) });
  });

  api.get("/reports/daily", (_req, res) => {
    const { memory, reportText } = generateDailyReport(ctx);
    res.json({ memory, reportText });
  });

  api.get("/reports/weekly", (_req, res) => {
    const { report, reportText } = generateWeeklyReport(ctx);
    res.json({ report, reportText });
  });

  // Preview artifact for side-by-side review (auth applies; path is fixed server-side).
  api.get("/previews/:leadId", (req, res) => {
    const project = ctx.store.siteProjects.list({ leadId: req.params.leadId, limit: 1 })[0];
    if (!project?.previewPath) {
      res.status(404).json({ error: "no_preview" });
      return;
    }
    const path = resolve(project.previewPath);
    const expectedRoot = resolve(join(ctx.config.dataDir, "previews"));
    if (!path.startsWith(expectedRoot + sep) || !existsSync(path)) {
      res.status(404).json({ error: "no_preview" });
      return;
    }
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:");
    res.sendFile(path);
  });

  // Audit/preview screenshots (auth applies; basename + root-prefix guard against traversal).
  api.get("/screenshots/:leadId/:file", (req, res) => {
    const file = basename(req.params.file!);
    const leadId = basename(req.params.leadId!);
    const expectedRoot = resolve(join(ctx.config.dataDir, "screenshots"));
    const path = resolve(join(expectedRoot, leadId, file));
    if (!file.endsWith(".png") || !path.startsWith(expectedRoot + sep) || !existsSync(path)) {
      res.status(404).json({ error: "no_screenshot" });
      return;
    }
    res.sendFile(path);
  });

  // Local-only demo helpers so the system is explorable without credentials.
  api.post("/demo/seed", async (_req: Request, res) => {
    if (ctx.config.env !== "local") {
      res.status(403).json({ error: "local_only" });
      return;
    }
    const summary = seedDemoData(ctx);
    await kickQueue(ctx);
    res.json({ summary });
  });

  api.post("/demo/reply", async (req, res) => {
    if (ctx.config.env !== "local") {
      res.status(403).json({ error: "local_only" });
      return;
    }
    const { leadId, text } = req.body as { leadId?: string; text?: string };
    if (!leadId || !text || !ctx.store.leads.get(leadId)) {
      res.status(400).json({ error: "leadId and text required" });
      return;
    }
    ctx.store.queue.enqueue({ type: "reply.process", payload: { leadId, text, provider: "manual" }, traceId: newTraceId(), leadId });
    await kickQueue(ctx);
    res.json({ ok: true });
  });

  return app;
}
