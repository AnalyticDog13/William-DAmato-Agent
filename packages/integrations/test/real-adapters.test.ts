import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger, loadConfig, type PolicyTicket } from "@william/core";
import {
  createGmailAdapter,
  createInstantlyAdapter,
  createIntegrations,
  createStripeAdapter,
  createVercelAdapter,
  stripeSignatureValid,
} from "../src";

const log = createLogger({ app: "test" }, () => {});

function ticket(dryRun: boolean): PolicyTicket {
  return {
    __policyTicket: true,
    gate: "SEND_PAYMENT_REQUEST",
    subjectType: "Test",
    subjectId: "subj_1",
    traceId: "trace_1",
    dryRun,
    issuedAt: new Date().toISOString(),
    nonce: "nonce_1",
  } as PolicyTicket;
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Fake fetch: records every call, replies from the queue (or a default). */
function fakeFetch(responses: Record<string, unknown>[] = []) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === "string" ? init.body : "",
    });
    const body = responses.shift() ?? { id: "ext_default" };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("real adapter safety contract", () => {
  it("throws without a PolicyTicket", async () => {
    const { impl } = fakeFetch();
    const stripe = createStripeAdapter({ env: { STRIPE_SECRET_KEY: "sk_test_1" }, fetchImpl: impl }, log);
    await expect(
      stripe.createPaymentLink(undefined as unknown as PolicyTicket, { description: "x", amountUsd: 1 }),
    ).rejects.toThrow(/SECURITY/);
  });

  it("dry-run tickets never touch the network (all four adapters)", async () => {
    const { impl, calls } = fakeFetch();
    const env = {
      STRIPE_SECRET_KEY: "sk",
      INSTANTLY_API_KEY: "ik",
      VERCEL_TOKEN: "vt",
      GMAIL_CLIENT_ID: "ci",
      GMAIL_CLIENT_SECRET: "cs",
      GMAIL_REFRESH_TOKEN: "rt",
    };
    const t = ticket(true);
    const results = [
      await createStripeAdapter({ env, fetchImpl: impl }, log).createPaymentLink(t, { description: "site", amountUsd: 500 }),
      await createInstantlyAdapter({ env, fetchImpl: impl }, log).pushLead(t, { email: "a@b.co" }),
      await createVercelAdapter({ env, fetchImpl: impl }, log).deploy(t, { target: "preview", projectName: "p", sourcePath: "/nope" }),
      await createGmailAdapter({ env, fetchImpl: impl }, log).send(t, { to: "a@b.co", subject: "s", body: "hi\nOPT", optOutLine: "OPT" }),
    ];
    expect(calls.length).toBe(0);
    for (const r of results) {
      expect(r.dryRun).toBe(true);
      expect(r.ok).toBe(true);
      expect(r.detail).toContain("DRY-RUN");
    }
  });
});

describe("stripe real adapter", () => {
  it("creates price then payment link with metadata, live", async () => {
    const { impl, calls } = fakeFetch([
      { id: "price_1" },
      { id: "plink_1", url: "https://buy.stripe.com/x" },
    ]);
    const stripe = createStripeAdapter({ env: { STRIPE_SECRET_KEY: "sk_test_1" }, fetchImpl: impl }, log);
    const res = await stripe.createPaymentLink(ticket(false), {
      description: "Website build",
      amountUsd: 750,
      metadata: { invoiceDraftId: "invd_9" },
    });
    expect(res).toMatchObject({ ok: true, dryRun: false, externalId: "plink_1", url: "https://buy.stripe.com/x" });
    expect(calls[0]!.url).toContain("/v1/prices");
    expect(calls[0]!.headers.authorization).toBe("Bearer sk_test_1");
    expect(calls[0]!.body).toContain("unit_amount=75000");
    expect(calls[1]!.url).toContain("/v1/payment_links");
    expect(calls[1]!.body).toContain(encodeURIComponent("line_items[0][price]") + "=price_1");
    expect(calls[1]!.body).toContain(encodeURIComponent("metadata[invoiceDraftId]") + "=invd_9");
  });

  it("reports failure (ok:false) on HTTP error without throwing", async () => {
    const impl = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
    const stripe = createStripeAdapter({ env: { STRIPE_SECRET_KEY: "sk" }, fetchImpl: impl }, log);
    const res = await stripe.createPaymentLink(ticket(false), { description: "x", amountUsd: 10 });
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("429");
  });
});

describe("stripe webhook signature (t=...,v1=...)", () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_1"}';
  const sign = (t: number) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

  it("accepts a fresh valid signature and rejects tampering", () => {
    const t = Math.floor(Date.now() / 1000);
    const header = `t=${t},v1=${sign(t)}`;
    expect(stripeSignatureValid(body, header, secret)).toBe(true);
    expect(stripeSignatureValid(body + "x", header, secret)).toBe(false);
    expect(stripeSignatureValid(body, `t=${t},v1=${"0".repeat(64)}`, secret)).toBe(false);
    expect(stripeSignatureValid(body, header, undefined)).toBe(false);
    expect(stripeSignatureValid(body, undefined, secret)).toBe(false);
  });

  it("rejects stale timestamps (replay protection)", () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    expect(stripeSignatureValid(body, `t=${stale},v1=${sign(stale)}`, secret)).toBe(false);
  });
});

describe("instantly real adapter", () => {
  it("pushes a lead with bearer auth, live", async () => {
    const { impl, calls } = fakeFetch([{ id: "lead_77" }]);
    const inst = createInstantlyAdapter({ env: { INSTANTLY_API_KEY: "ik_1", INSTANTLY_CAMPAIGN_ID: "camp_1" }, fetchImpl: impl }, log);
    const res = await inst.pushLead(ticket(false), { email: "owner@biz.co", companyName: "Biz" });
    expect(res).toMatchObject({ ok: true, dryRun: false, externalId: "lead_77" });
    expect(calls[0]!.url).toContain("/api/v2/leads");
    expect(calls[0]!.headers.authorization).toBe("Bearer ik_1");
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ email: "owner@biz.co", campaign: "camp_1" });
  });
});

describe("gmail real adapter", () => {
  it("refuses email missing the opt-out line even live", async () => {
    const { impl, calls } = fakeFetch();
    const gmail = createGmailAdapter({ env: { GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: "c" }, fetchImpl: impl }, log);
    const res = await gmail.send(ticket(false), { to: "x@y.co", subject: "s", body: "no opt out here", optOutLine: "Reply STOP to opt out." });
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("opt-out");
    expect(calls.length).toBe(0);
  });

  it("exchanges refresh token then sends base64url MIME, live", async () => {
    const { impl, calls } = fakeFetch([{ access_token: "at_1" }, { id: "msg_5" }]);
    const gmail = createGmailAdapter({ env: { GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: "c" }, fetchImpl: impl }, log);
    const res = await gmail.send(ticket(false), { to: "x@y.co", subject: "Hello", body: "Hi.\nReply STOP to opt out.", optOutLine: "Reply STOP to opt out." });
    expect(res).toMatchObject({ ok: true, dryRun: false, externalId: "msg_5" });
    expect(calls[0]!.url).toContain("oauth2.googleapis.com/token");
    expect(calls[0]!.body).toContain("grant_type=refresh_token");
    expect(calls[1]!.headers.authorization).toBe("Bearer at_1");
    const raw = (JSON.parse(calls[1]!.body) as { raw: string }).raw;
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("To: x@y.co");
    expect(mime).toContain("Reply STOP to opt out.");
  });
});

describe("vercel real adapter", () => {
  it("uploads source file inline and returns deployment url, live", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wdam-vercel-"));
    writeFileSync(join(dir, "index.html"), "<html>preview</html>", "utf8");
    const { impl, calls } = fakeFetch([{ id: "dpl_3", url: "p-abc.vercel.app" }]);
    const vercel = createVercelAdapter({ env: { VERCEL_TOKEN: "vt_1", VERCEL_TEAM_ID: "team_1" }, fetchImpl: impl }, log);
    const res = await vercel.deploy(ticket(false), { target: "preview", projectName: "p", sourcePath: dir });
    expect(res).toMatchObject({ ok: true, dryRun: false, externalId: "dpl_3", url: "https://p-abc.vercel.app" });
    expect(calls[0]!.url).toContain("/v13/deployments");
    expect(calls[0]!.url).toContain("teamId=team_1");
    const sent = JSON.parse(calls[0]!.body) as { files: { file: string; data: string }[]; target?: string };
    expect(sent.files[0]).toMatchObject({ file: "index.html", data: "<html>preview</html>" });
    expect(sent.target).toBeUndefined();
  });
});

describe("registry credential selection", () => {
  const config = loadConfig();

  it("selects real adapters when credentials are present, mocks otherwise", () => {
    const none = createIntegrations(config, log, { env: {} });
    expect(none.stripe.name).toBe("mock-stripe");
    expect(none.instantly.name).toBe("mock-instantly");
    expect(none.vercel.name).toBe("mock-vercel");
    expect(none.email.name).toBe("mock-gmail");

    const all = createIntegrations(config, log, {
      env: {
        STRIPE_SECRET_KEY: "sk",
        INSTANTLY_API_KEY: "ik",
        VERCEL_TOKEN: "vt",
        GMAIL_CLIENT_ID: "a",
        GMAIL_CLIENT_SECRET: "b",
        GMAIL_REFRESH_TOKEN: "c",
      },
    });
    expect(all.stripe.name).toBe("stripe");
    expect(all.instantly.name).toBe("instantly");
    expect(all.vercel.name).toBe("vercel");
    expect(all.email.name).toBe("gmail");
  });

  it("partial credentials select only the matching real adapter", () => {
    const some = createIntegrations(config, log, { env: { STRIPE_SECRET_KEY: "sk", GMAIL_CLIENT_ID: "a" } });
    expect(some.stripe.name).toBe("stripe");
    expect(some.email.name).toBe("mock-gmail"); // incomplete OAuth triple
    expect(some.instantly.name).toBe("mock-instantly");
  });
});
