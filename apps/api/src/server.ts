import { existsSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import express, { type Express, type Request } from "express";
import { GATE_DEFINITIONS, NICHE_META, Niche, PolicyGateName, newId, newTraceId, nowIso } from "@william/core";
import type { Repository } from "@william/db";
import {
  computeMetrics,
  decideApproval,
  generateDailyReport,
  ingestLead,
  requestApproval,
  runUntilEmpty,
  seedDemoData,
  type AppContext,
} from "@william/worker-orchestrator";
import { requireOwner, resolveOwnerToken } from "./auth";
import { cors, rateLimit, securityHeaders } from "./security";

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
    "sourcing-runs": s.sourcingRuns,
    approvals: s.approvals,
    failures: s.failures,
    "daily-memories": s.dailyMemories,
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

  // Public endpoints (rate-limited): health.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, env: ctx.config.env, dryRun: ctx.config.dryRun });
  });

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
    res.json({
      lead,
      company: ctx.store.companies.get(lead.companyId),
      contacts: ctx.store.contacts.list({ leadId: lead.id }),
      audits: ctx.store.audits.list({ leadId: lead.id }),
      scores: ctx.store.leadScores.list({ leadId: lead.id }),
      drafts: ctx.store.outreachDrafts.list({ leadId: lead.id }),
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
        } else if (approval.gate === "ACTIVATE_NEW_LEAD_SOURCE") {
          const run = ctx.store.sourcingRuns.get(approval.subjectId);
          if (run) {
            ctx.store.sourcingRuns.save({ ...run, status: "running", updatedAt: nowIso() });
            ctx.store.queue.enqueue({ type: "lead.source", payload: { sourcingRunId: run.id }, traceId: approval.traceId });
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

  // Sourcing runs: owner triggers a one-click batch lead-sourcing session.
  // POST creates a SourcingRun (pending_approval) + ACTIVATE_NEW_LEAD_SOURCE approval.
  // Granting that approval sets the run to "running" and enqueues lead.source.
  // mode="batch": ignores niche/target, sweeps all niches up to candidateCap.
  // mode="normal" (default): requires valid niche + positive integer target.
  api.post("/sourcing-runs", (req, res) => {
    const body = req.body ?? {};
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const mode = body.mode === "batch" ? "batch" : "normal";

    if (!location) {
      res.status(400).json({ error: "location is required" });
      return;
    }

    const candidateCap =
      Number.isInteger(body.candidateCap) && (body.candidateCap as number) > 0
        ? (body.candidateCap as number)
        : ctx.config.leadSourcing.defaultCandidateCap;

    let niche: Niche;
    let target: number;
    let nicheQueue: Niche[];
    let currentNiche: Niche | null;

    if (mode === "batch") {
      nicheQueue = (Object.keys(NICHE_META) as Niche[]).filter((n) => n !== "other");
      currentNiche = nicheQueue[0] ?? null;
      niche = nicheQueue[0] ?? "other";
      target = candidateCap; // cap-governed; target = cap
    } else {
      const parsedNiche = Niche.safeParse(body.niche);
      const parsedTarget = Number(body.target);
      if (!parsedNiche.success || !Number.isInteger(parsedTarget) || parsedTarget <= 0) {
        res.status(400).json({ error: "location, valid niche, and positive integer target required" });
        return;
      }
      niche = parsedNiche.data;
      target = parsedTarget;
      nicheQueue = [];
      currentNiche = null;
    }

    const now = nowIso();
    const traceId = newTraceId();
    const run = ctx.store.sourcingRuns.insert({
      id: newId("src"),
      createdAt: now,
      updatedAt: now,
      location,
      niche,
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
      mode,
      nicheQueue,
      currentNiche,
    });
    const approvalTitle = mode === "batch"
      ? `Batch-source up to ${candidateCap} leads across all niches in ${location}`
      : `Source ${target} ${niche} lead(s) in ${location}`;
    const approval = requestApproval(ctx, {
      gate: "ACTIVATE_NEW_LEAD_SOURCE",
      subjectType: "SourcingRun",
      subjectId: run.id,
      leadId: null,
      title: approvalTitle,
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

  api.get("/jobs", (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json({ items: ctx.store.queue.list({ status: q.status, limit: q.limit ? Number(q.limit) : 200 }) });
  });

  api.get("/reports/daily", (_req, res) => {
    const { memory, reportText } = generateDailyReport(ctx);
    res.json({ memory, reportText });
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

  return app;
}
