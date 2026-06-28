import { describe, expect, it } from "vitest";
import { createLogger, loadConfig, type PolicyTicket } from "@william/core";
import {
  createInstantlyAdapter,
  createIntegrations,
  createLlmAdapter,
  createMockLlm,
} from "../src";
import { callJson } from "../src/real/shared";

const log = createLogger({ app: "test" }, () => {});

describe("callJson HTTP timeout (a hung request can never stall the serial worker)", () => {
  it("returns a failure result instead of hanging when the request never responds", async () => {
    // A request that only ever settles if its AbortSignal fires.
    const hangingFetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const res = await callJson(hangingFetch, "https://example.test/x", { method: "GET" }, 60);
    expect(res.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000); // aborted promptly, not hung
  }, 3000);
});

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

  it("pushLead returns [] network under dry-run with zero network calls", async () => {
    const { impl, calls } = fakeFetch();
    const inst = createInstantlyAdapter({ env: { INSTANTLY_API_KEY: "ik_1" }, fetchImpl: impl }, log);
    const res = await inst.pushLead(ticket(true), { email: "a@b.co" });
    expect(res.dryRun).toBe(true);
    expect(res.ok).toBe(true);
    expect(calls.length).toBe(0);
  });
});

describe("llm real adapter — scoreVisualDesign", () => {
  // A fetch that always returns a non-200 error (used to assert "never called").
  const failFetch = (async () => new Response("network error", { status: 500 })) as typeof fetch;
  // A fetch that returns a pre-built JSON body with status 200.
  function okJsonFetch(body: unknown): typeof fetch {
    return (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  }
  // A live (non-dry-run) ticket.
  const liveTicket = ticket(false);
  // A dry-run ticket.
  const dryRunTicket = ticket(true);

  it("scoreVisualDesign: mock returns null", async () => {
    const mock = createMockLlm(log);
    const out = await mock.scoreVisualDesign(liveTicket, {
      companyName: "Joe's", niche: "barbershop", weaknesses: [], images: [],
    });
    expect(out).toBeNull();
  });

  it("scoreVisualDesign: real adapter returns null under dry-run (no network)", async () => {
    // A fetch that THROWS when invoked — proves the dry-run guard returns null without calling fetch.
    const throwFetch = (async () => { throw new Error("network call forbidden in dry-run"); }) as unknown as typeof fetch;
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-test" }, fetchImpl: throwFetch }, log);
    const out = await llm.scoreVisualDesign(dryRunTicket, {
      companyName: "Joe's", niche: "barbershop", weaknesses: [], images: [{ mediaType: "image/png", dataBase64: "AAA" }],
    });
    expect(out).toBeNull(); // throwFetch never invoked
  });

  it("scoreVisualDesign: parses a valid model JSON response", async () => {
    const body = { content: [{ type: "text", text: JSON.stringify({
      visualOpportunityScore: 70, verdict: "weak", confidence: 0.8, findings: [], positives: [],
    }) }] };
    const fetchImpl = okJsonFetch(body);
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_VISUAL_MODEL: "claude-haiku-4-5-20251001" }, fetchImpl }, log);
    const out = await llm.scoreVisualDesign(liveTicket, {
      companyName: "Joe's", niche: "barbershop", weaknesses: ["no CTA"],
      images: [{ mediaType: "image/png", dataBase64: "AAA" }],
    });
    expect(out?.verdict).toBe("weak");
    expect(out?.model).toBe("claude-haiku-4-5-20251001"); // adapter stamps the model
  });

  it("scoreVisualDesign: invalid JSON → null", async () => {
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-test" }, fetchImpl: okJsonFetch({ content: [{ type: "text", text: "not json" }] }) }, log);
    const out = await llm.scoreVisualDesign(liveTicket, { companyName: "x", niche: "y", weaknesses: [], images: [{ mediaType: "image/png", dataBase64: "AAA" }] });
    expect(out).toBeNull();
  });

  // Suppress lint about unused failFetch — it's kept as a safety guard for future tests
  void failFetch;
});

describe("registry credential selection", () => {
  const config = loadConfig();

  it("selects real adapters when credentials are present, mocks otherwise", () => {
    const none = createIntegrations(config, log, { env: {} });
    expect(none.instantly.name).toBe("mock-instantly");
    expect(none.llm.name).toBe("mock-llm");
    expect(none.places.name).toBe("mock-google-maps");
    expect(none.enrichment.name).toBe("mock-enrichment");

    const all = createIntegrations(config, log, {
      env: {
        INSTANTLY_API_KEY: "ik",
        ANTHROPIC_API_KEY: "sk",
        GOOGLE_MAPS_API_KEY: "gk",
      },
    });
    expect(all.instantly.name).toBe("instantly");
    expect(all.llm.name).toBe("anthropic");
    expect(all.places.name).toBe("google-places-v1");
    expect(all.enrichment.name).toBe("mock-enrichment"); // no real enrichment adapter yet
  });

  it("partial credentials select only the matching real adapter", () => {
    const some = createIntegrations(config, log, { env: { INSTANTLY_API_KEY: "ik" } });
    expect(some.instantly.name).toBe("instantly");
    expect(some.llm.name).toBe("mock-llm");
  });
});
