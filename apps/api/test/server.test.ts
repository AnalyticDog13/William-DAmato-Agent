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

  it("validates policy updates", async () => {
    const bad = await authed("/api/policies/NOT_A_GATE", { method: "POST", body: JSON.stringify({ mode: "closed" }) });
    expect(bad.status).toBe(400);
    const ok = await authed("/api/policies/SEND_PAYMENT_REQUEST", { method: "POST", body: JSON.stringify({ mode: "closed", note: "off" }) });
    expect(ok.status).toBe(200);
    expect(ctx.store.getGatePolicy("SEND_PAYMENT_REQUEST").mode).toBe("closed");
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
