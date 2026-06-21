import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, type AppContext } from "@william/worker-orchestrator";
import { createServer } from "../src/server";

let ctx: AppContext;
let server: Server;
let base: string;
const TOKEN = "test-owner-token-1234";

beforeAll(async () => {
  process.env.OWNER_API_TOKEN = TOKEN;
  delete process.env.INSTANTLY_WEBHOOK_SECRET;
  ctx = createContext({ inMemory: true, silent: true });
  const app = createServer(ctx);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

const authed = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });

describe("screenshot route", () => {
  it("requires auth, 404s on missing files, and rejects traversal", async () => {
    expect((await fetch(`${base}/api/screenshots/lead_x/home-desktop.png`)).status).toBe(401);
    expect((await authed("/api/screenshots/lead_x/home-desktop.png")).status).toBe(404);
    expect((await authed("/api/screenshots/lead_x/..%2F..%2Fwilliam.db")).status).toBe(404);
    expect((await authed("/api/screenshots/..%2F..%2Fetc/passwd.png")).status).toBe(404);
  });
});

describe("API auth (server-side, every route)", () => {
  it("rejects missing and wrong tokens", async () => {
    expect((await fetch(`${base}/api/overview`)).status).toBe(401);
    expect(
      (await fetch(`${base}/api/overview`, { headers: { authorization: "Bearer wrong" } })).status,
    ).toBe(401);
  });

  it("accepts the owner token", async () => {
    const res = await authed("/api/overview");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dryRun: boolean };
    expect(body.dryRun).toBe(true); // local env always dry-run
  });

  it("health endpoint is public but leaks nothing sensitive", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toMatch(/token/i);
  });

  it("sets security headers", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("experiments API", () => {
  it("rejects outreach_variant experiments with unregistered variants", async () => {
    const res = await authed("/api/experiments", {
      method: "POST",
      body: JSON.stringify({ name: "bad", hypothesis: "h", dimension: "outreach_variant", variants: ["v1-cornell-mockup", "v9-nope"] }),
    });
    expect(res.status).toBe(400);
  });

  it("creates, computes, and concludes an experiment", async () => {
    const create = await authed("/api/experiments", {
      method: "POST",
      body: JSON.stringify({
        name: "copy A/B",
        hypothesis: "finding-first wins",
        dimension: "outreach_variant",
        variants: ["v1-cornell-mockup", "v2-finding-first"],
      }),
    });
    expect(create.status).toBe(201);
    const { experiment } = (await create.json()) as { experiment: { id: string; status: string } };
    expect(experiment.status).toBe("running");

    const compute = await authed(`/api/experiments/${experiment.id}/compute`, { method: "POST" });
    expect(compute.status).toBe(200);
    const { results } = (await compute.json()) as { results: unknown[] };
    expect(Array.isArray(results)).toBe(true);

    const conclude = await authed(`/api/experiments/${experiment.id}/conclude`, {
      method: "POST",
      body: JSON.stringify({ status: "concluded", conclusion: "v2 wins" }),
    });
    expect(conclude.status).toBe(200);
    expect(ctx.store.experiments.get(experiment.id)!.status).toBe("concluded");
    expect(ctx.store.experiments.get(experiment.id)!.conclusion).toBe("v2 wins");
  });

  it("validates required fields and conclude status", async () => {
    expect((await authed("/api/experiments", { method: "POST", body: JSON.stringify({ name: "", hypothesis: "", dimension: "bogus", variants: [] }) })).status).toBe(400);
    expect((await authed("/api/experiments/exp_missing/conclude", { method: "POST", body: JSON.stringify({ status: "concluded", conclusion: "x" }) })).status).toBe(404);
  });
});

describe("owner-triggered preview deploy API", () => {
  function insertProject(previewPath: string | null) {
    const now = new Date().toISOString();
    const leadId = `lead_pv_${Math.random().toString(36).slice(2, 8)}`;
    return ctx.store.siteProjects.insert({
      id: `sp_${Math.random().toString(36).slice(2, 10)}`,
      createdAt: now,
      updatedAt: now,
      leadId,
      opportunityId: null,
      templateId: "barber-classic",
      niche: "barbershop",
      status: "preview_ready",
      previewUrl: null,
      previewPath,
      stack: "static",
      buildPath: null,
      screenshotPaths: [],
      rationale: "",
      companyData: {},
      missingInputs: [],
      qualityCheck: null,
    });
  }

  it("409s when the project has no artifact", async () => {
    ctx.config.williamBuildsWebsites = true;
    const project = insertProject(null);
    expect((await authed(`/api/site-projects/${project.id}/deploy-preview`, { method: "POST" })).status).toBe(409);
  });

  it("enqueues deploy.preview and records a dry-run deployment", async () => {
    ctx.config.williamBuildsWebsites = true;
    const project = insertProject("C:/tmp/preview/index.html");
    const res = await authed(`/api/site-projects/${project.id}/deploy-preview`, { method: "POST" });
    expect(res.status).toBe(202);
    const deployments = ctx.store.deployments.list({ limit: 50 }).filter((d) => d.siteProjectId === project.id);
    expect(deployments).toHaveLength(1);
    expect(deployments[0]!.target).toBe("preview");
    expect(deployments[0]!.status).toBe("dry_run");
  });
});

describe("transcript ingestion API", () => {
  it("accepts owner transcripts and turns them into lessons via the queue", async () => {
    const res = await authed("/api/transcripts", {
      method: "POST",
      body: JSON.stringify({
        source: "api-design-notes.txt",
        text: "Keep the hero animation subtle; heavy motion hurts mobile conversion rates.",
      }),
    });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { jobId: string }).jobId).toBeTruthy();
    expect(ctx.store.lessons.list({ skey: "design" }).length).toBeGreaterThan(0);
  });

  it("rejects missing source/text and oversized payloads", async () => {
    expect((await authed("/api/transcripts", { method: "POST", body: JSON.stringify({ source: "", text: "x" }) })).status).toBe(400);
    expect((await authed("/api/transcripts", { method: "POST", body: JSON.stringify({ source: "a.txt", text: "" }) })).status).toBe(400);
    expect((await authed("/api/transcripts", { method: "POST", body: JSON.stringify({ source: "a.txt", text: "x".repeat(100_001) }) })).status).toBe(400);
  });
});

describe("lead + approval flow over HTTP", () => {
  it("creates a lead, runs the inline pipeline, exposes the review queue", async () => {
    const res = await authed("/api/leads", {
      method: "POST",
      body: JSON.stringify({ companyName: "API Test Barbers", websiteUrl: "https://apitest.example.com", niche: "barbershop", city: "Ithaca" }),
    });
    expect(res.status).toBe(201);
    const queue = (await (await authed("/api/review-queue")).json()) as { items: { id: string; gate: string }[] };
    expect(queue.items.length).toBeGreaterThan(0);
    expect(queue.items[0]!.gate).toBe("SEND_FIRST_TOUCH");

    const decide = await authed(`/api/approvals/${queue.items[0]!.id}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision: "granted", note: "test approve" }),
    });
    expect(decide.status).toBe(200);
    expect(ctx.store.campaignSyncs.count()).toBe(1);
    expect(ctx.store.campaignSyncs.list()[0]!.status).toBe("dry_run");
  });

  it("rejects duplicate leads with 409", async () => {
    const res = await authed("/api/leads", {
      method: "POST",
      body: JSON.stringify({ companyName: "API Test Barbers", niche: "barbershop", city: "Ithaca" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejecting a SEND_FIRST_TOUCH email draft sets the draft status to rejected", async () => {
    await authed("/api/leads", {
      method: "POST",
      body: JSON.stringify({ companyName: "Reject Flow Co", websiteUrl: "https://rejectflow.example.com", niche: "barbershop", city: "Ithaca" }),
    });
    const leadId = ctx.store.leads.list().find((l) => ctx.store.companies.get(l.companyId)?.name === "Reject Flow Co")!.id;
    const draft = ctx.store.outreachDrafts.list({ leadId })[0]!;
    expect(draft).toBeDefined();
    expect(draft.status).not.toBe("rejected");
    const approval = ctx.store.approvals.list().find((a) => a.gate === "SEND_FIRST_TOUCH" && a.subjectId === draft.id)!;
    expect(approval).toBeDefined();

    const decide = await authed(`/api/approvals/${approval.id}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision: "rejected", note: "not a fit" }),
    });
    expect(decide.status).toBe(200);
    expect(ctx.store.outreachDrafts.get(draft.id)!.status).toBe("rejected");
  });

  it("validates policy updates", async () => {
    const bad = await authed("/api/policies/NOT_A_GATE", { method: "POST", body: JSON.stringify({ mode: "closed" }) });
    expect(bad.status).toBe(400);
    const ok = await authed("/api/policies/SEND_PAYMENT_REQUEST", { method: "POST", body: JSON.stringify({ mode: "closed", note: "off" }) });
    expect(ok.status).toBe(200);
    expect(ctx.store.getGatePolicy("SEND_PAYMENT_REQUEST").mode).toBe("closed");
  });
});

describe("site project routes (revision loop + deploy approval)", () => {
  let projectId: string;
  let leadId: string;

  it("positive reply builds a preview project (inline worker)", async () => {
    ctx.config.williamBuildsWebsites = true; // builder-on: positive reply builds a preview to revise/deploy
    await authed("/api/leads", {
      method: "POST",
      body: JSON.stringify({ companyName: "Deploy Flow Cafe", websiteUrl: "https://deployflow.example.com", niche: "coffee_shop", city: "Ithaca" }),
    });
    const leads = (await (await authed("/api/collections/leads?search=Deploy")).json()) as { items: { id: string }[] };
    leadId = ctx.store.leads.list().find((l) => ctx.store.companies.get(l.companyId)?.name === "Deploy Flow Cafe")!.id;
    expect(leads.items.length).toBeGreaterThan(0);
    await authed("/api/demo/reply", { method: "POST", body: JSON.stringify({ leadId, text: "Yes please, send the mockup!" }) });
    const project = ctx.store.siteProjects.list({ leadId })[0]!;
    expect(project).toBeDefined();
    projectId = project.id;
  });

  it("revision with structured overrides is applied inline and shows in the timeline", async () => {
    ctx.config.williamBuildsWebsites = true;
    const res = await authed(`/api/site-projects/${projectId}/revisions`, {
      method: "POST",
      body: JSON.stringify({ request: "new tagline please", overrides: { tagline: "Espresso, properly." } }),
    });
    expect(res.status).toBe(201);
    const timeline = (await (await authed(`/api/leads/${leadId}/timeline`)).json()) as {
      siteRevisions: { status: string }[];
    };
    expect(timeline.siteRevisions[0]!.status).toBe("applied");
    expect((ctx.store.siteProjects.get(projectId)!.companyData as { tagline?: string }).tagline).toBe("Espresso, properly.");
  });

  it("revision without request text is rejected", async () => {
    ctx.config.williamBuildsWebsites = true;
    const res = await authed(`/api/site-projects/${projectId}/revisions`, { method: "POST", body: JSON.stringify({ overrides: {} }) });
    expect(res.status).toBe(400);
  });

  it("request-deploy creates a DEPLOY_PRODUCTION approval; granting it deploys dry-run only", async () => {
    ctx.config.williamBuildsWebsites = true;
    const res = await authed(`/api/site-projects/${projectId}/request-deploy`, { method: "POST" });
    expect(res.status).toBe(201);
    const { approval } = (await res.json()) as { approval: { id: string; gate: string; status: string } };
    expect(approval.gate).toBe("DEPLOY_PRODUCTION");
    expect(approval.status).toBe("pending");
    const projectDeployments = () => ctx.store.deployments.list({ limit: 100 }).filter((d) => d.siteProjectId === projectId);
    expect(projectDeployments()).toHaveLength(0); // nothing until granted

    const decide = await authed(`/api/approvals/${approval.id}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision: "granted", note: "ship" }),
    });
    expect(decide.status).toBe(200);
    const record = projectDeployments()[0]!;
    expect(record.target).toBe("production");
    expect(record.status).toBe("dry_run"); // local env can NEVER deploy live
    expect(ctx.store.siteProjects.get(projectId)!.status).toBe("approved_for_customer");
  });

  it("404s on unknown projects", async () => {
    expect((await authed("/api/site-projects/site_nope/request-deploy", { method: "POST" })).status).toBe(404);
    expect((await authed("/api/site-projects/site_nope/revisions", { method: "POST", body: JSON.stringify({ request: "x" }) })).status).toBe(404);
  });
});

describe("builder routes disabled when WILLIAM_BUILDS_WEBSITES=false (default)", () => {
  it("revisions, request-deploy, and deploy-preview all return 403 builder_disabled", async () => {
    ctx.config.williamBuildsWebsites = false;
    const now = new Date().toISOString();
    const project = ctx.store.siteProjects.insert({
      id: `sp_off_${Math.random().toString(36).slice(2, 10)}`,
      createdAt: now,
      updatedAt: now,
      leadId: `lead_off_${Math.random().toString(36).slice(2, 8)}`,
      opportunityId: null,
      templateId: "barber-classic",
      niche: "barbershop",
      status: "preview_ready",
      previewUrl: null,
      previewPath: "C:/tmp/preview/index.html", // has an artifact: proves 403 is the flag, not a 409
      stack: "static",
      buildPath: null,
      screenshotPaths: [],
      rationale: "",
      companyData: {},
      missingInputs: [],
      qualityCheck: null,
    });
    const rev = await authed(`/api/site-projects/${project.id}/revisions`, {
      method: "POST",
      body: JSON.stringify({ request: "change tagline", overrides: { tagline: "x" } }),
    });
    expect(rev.status).toBe(403);
    expect(((await rev.json()) as { error: string }).error).toBe("builder_disabled");
    expect((await authed(`/api/site-projects/${project.id}/request-deploy`, { method: "POST" })).status).toBe(403);
    expect((await authed(`/api/site-projects/${project.id}/deploy-preview`, { method: "POST" })).status).toBe(403);
    // Unknown projects still 404 (the flag check never masks not_found).
    expect((await authed("/api/site-projects/site_nope/revisions", { method: "POST", body: JSON.stringify({ request: "x" }) })).status).toBe(404);
  });
});

describe("sourcing-runs API", () => {
  it("POST /api/sourcing-runs creates a run + ACTIVATE_NEW_LEAD_SOURCE approval", async () => {
    const res = await authed("/api/sourcing-runs", {
      method: "POST",
      body: JSON.stringify({ location: "Ithaca, NY", niche: "coffee_shop", target: 5 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { run: { status: string; approvalRequestId: string }; approval: { id: string; gate: string } };
    expect(body.run.status).toBe("pending_approval");
    expect(body.approval.gate).toBe("ACTIVATE_NEW_LEAD_SOURCE");
    // Fix 1: assert the approval back-fill — a dropped save() would silently pass without this
    expect(body.run.approvalRequestId).toBe(body.approval.id);
  });

  it("rejects an unknown niche", async () => {
    const res = await authed("/api/sourcing-runs", {
      method: "POST",
      body: JSON.stringify({ location: "X", niche: "not_a_niche", target: 3 }),
    });
    expect(res.status).toBe(400);
  });

  it("granting ACTIVATE_NEW_LEAD_SOURCE sets run to running and enqueues lead.source", async () => {
    // Create a sourcing run (mirrors the pattern above)
    const createRes = await authed("/api/sourcing-runs", {
      method: "POST",
      body: JSON.stringify({ location: "Buffalo, NY", niche: "barbershop", target: 3 }),
    });
    expect(createRes.status).toBe(201);
    const { run, approval } = (await createRes.json()) as {
      run: { id: string; status: string; approvalRequestId: string };
      approval: { id: string; gate: string };
    };
    expect(run.status).toBe("pending_approval");

    // Grant the approval — mirrors the mechanism used in the DEPLOY_PRODUCTION and
    // SEND_FIRST_TOUCH grant tests (same decide endpoint + payload + authed helper)
    const decide = await authed(`/api/approvals/${approval.id}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision: "granted", note: "kick off sourcing" }),
    });
    expect(decide.status).toBe(200);

    // Assert run status changed to "running" (observable via ctx.store, same pattern
    // as ctx.store.siteProjects.get(projectId)!.status in the DEPLOY_PRODUCTION test)
    expect(ctx.store.sourcingRuns.get(run.id)!.status).toBe("running");

    // Assert a lead.source job was enqueued with the correct sourcingRunId
    // (ctx.store.queue.list() is the same accessor used implicitly by the worker;
    // the queue is fully observable in-memory — same approach as ctx.store.campaignSyncs
    // and ctx.store.deployments in the SEND_FIRST_TOUCH and DEPLOY_PRODUCTION grant tests)
    const sourceJobs = ctx.store.queue.list().filter(
      (j) => j.type === "lead.source" && (j.payload as { sourcingRunId?: string }).sourcingRunId === run.id,
    );
    expect(sourceJobs.length).toBeGreaterThan(0);
  });
});

describe("webhooks", () => {
  it("accepts unsigned webhooks ONLY in local dry-run, recording a compliance event", async () => {
    const res = await fetch(`${base}/webhooks/instantly`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type: "campaign_completed" }),
    });
    expect(res.status).toBe(200);
    expect(ctx.store.complianceEvents.list({ status: "webhook_unsigned_accepted_dry_run" }).length).toBeGreaterThan(0);
  });

  it("rejects bad signatures when a secret is configured", async () => {
    process.env.INSTANTLY_WEBHOOK_SECRET = "whsec_test";
    const body = JSON.stringify({ event_type: "reply_received" });
    const bad = await fetch(`${base}/webhooks/instantly`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-instantly-signature": "deadbeef" },
      body,
    });
    expect(bad.status).toBe(401);

    const goodSig = createHmac("sha256", "whsec_test").update(body).digest("hex");
    const good = await fetch(`${base}/webhooks/instantly`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-instantly-signature": goodSig },
      body,
    });
    expect(good.status).toBe(200);
    delete process.env.INSTANTLY_WEBHOOK_SECRET;
  });
});
