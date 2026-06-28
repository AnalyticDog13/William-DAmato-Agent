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

