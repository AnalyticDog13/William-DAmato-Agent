# Instantly Reply Poller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest inbound Instantly replies via the v2 `GET /emails` API (polling) instead of the Hypergrowth-gated webhook, feeding the existing `reply.process` pipeline — so the reply→brief→ship loop runs on the current ($0-extra) Instantly plan.

**Architecture:** A new ungated read adapter method `instantly.pollInbound` fetches recent `email_type=received` messages. A new `instantly.pollReplies` job resolves each sender to a known lead, dedupes against persisted `replyEvents` by provider message id, and enqueues the exact same `reply.process` jobs the webhook produces. Scheduling is interval-driven from the worker entry point, gated behind a config flag that defaults OFF. Mock-first: `local` stays dry-run (zero network, empty inbound), so demo/tests are unchanged.

**Tech Stack:** TypeScript (strict, tsx/vite), SQLite durable queue, zod schemas, vitest.

---

## Why polling (route evaluation)

- **Confirmed:** Instantly v2 `GET /api/v2/emails` supports `email_type=received` (incoming/campaign responses) and `preview_only=false` (full body text), Bearer-auth with the existing `INSTANTLY_API_KEY`. This returns the inbound reply bodies we need.
- **Webhooks** require the $97/mo Hypergrowth tier — the thing we're avoiding.
- **Gmail polling** is rejected: the Gmail grant is send-only by design (invariant 1), and Instantly replies land in Instantly-managed mailboxes, not the owner's Gmail.
- **Scope of v1:** replies (and any bounce/unsubscribe text that arrives *as a received email* — handled by the existing `classifyReplyAssisted`). Instantly's *native* bounce (`i_status`) and unsubscribe-link events are NOT received emails and remain webhook-only; documented as a known gap. DNC/unsubscribe screening at draft+send (invariant 4) is unaffected.

## Safety invariants honored

1. Inbound email stays **data** — the poller can only enqueue the fixed `reply.process` handler; text is never executed or placed in a prompt as instructions.
2. `pollInbound` requires a PolicyTicket; it's an ungated **read** via `operationalTicket` (no credential → engine forces dry-run). No new policy gate.
3. `local` = dry-run forces `pollInbound` to return `[]` with zero network.
4. DNC/unsubscribe handling is downstream in `handleReply`, unchanged.

## File structure

- Modify `packages/core/src/env.ts` — `instantlyPollIntervalMs` on `RuntimeConfig` + `loadConfig`.
- Modify `packages/integrations/src/types.ts` — `InboundEmail` type + `pollInbound` on `InstantlyAdapter`.
- Modify `packages/integrations/src/mocks.ts` — mock `pollInbound` → `[]`.
- Modify `packages/integrations/src/real/instantly.ts` — real `pollInbound`.
- Modify `workers/orchestrator/src/pipelines.ts` — `handlePollReplies` + `JOB_HANDLERS` entry.
- Modify `workers/orchestrator/src/main.ts` — interval scheduling when flag > 0.
- Modify `packages/integrations/test/real-adapters.test.ts` — adapter tests.
- Modify `workers/orchestrator/test/pipeline.test.ts` — handler tests.
- Modify `.env.example` — document `INSTANTLY_POLL_INTERVAL_MS`.
- Modify `CLAUDE.md` — handoff status note.

---

### Task 1: Config flag `instantlyPollIntervalMs`

**Files:**
- Modify: `packages/core/src/env.ts`
- Test: `packages/core/test/env.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the existing describe)

```ts
it("parses INSTANTLY_POLL_INTERVAL_MS (default 0 = disabled)", () => {
  expect(loadConfig({ WILLIAM_ENV: "local" }).instantlyPollIntervalMs).toBe(0);
  expect(loadConfig({ WILLIAM_ENV: "staging", INSTANTLY_POLL_INTERVAL_MS: "300000" }).instantlyPollIntervalMs).toBe(300000);
  expect(loadConfig({ WILLIAM_ENV: "local", INSTANTLY_POLL_INTERVAL_MS: "-5" }).instantlyPollIntervalMs).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm test -- env` → FAIL (property missing).

- [ ] **Step 3: Add the field to `RuntimeConfig`** (after `williamBuildsWebsites`):

```ts
  /**
   * How often (ms) to poll Instantly's /emails API for inbound replies, as a
   * free alternative to the Hypergrowth-gated webhook. 0 disables polling
   * (default). Inert in local (dry-run forces pollInbound to return []).
   */
  instantlyPollIntervalMs: number;
```

- [ ] **Step 4: Parse it in `loadConfig`** (in the returned object):

```ts
    instantlyPollIntervalMs: (() => {
      const n = Number(env.INSTANTLY_POLL_INTERVAL_MS);
      return Number.isFinite(n) && n > 0 ? n : 0;
    })(),
```

- [ ] **Step 5: Run test to verify it passes** — `npm test -- env` → PASS.

- [ ] **Step 6: Commit** — `feat(config): add INSTANTLY_POLL_INTERVAL_MS`.

---

### Task 2: `InboundEmail` type + `pollInbound` on the adapter interface

**Files:**
- Modify: `packages/integrations/src/types.ts`

- [ ] **Step 1: Add the type** (above `InstantlyAdapter`):

```ts
/** A normalized inbound message fetched by polling (provider-agnostic shape). */
export interface InboundEmail {
  /** Provider message id — the dedup key. */
  externalMessageId: string;
  /** Lowercased sender address (the lead). */
  fromEmail: string;
  /** Plain-text body (data only — never executed). */
  text: string;
}
```

- [ ] **Step 2: Add the method to `InstantlyAdapter`** (after `pauseLead`):

```ts
  /**
   * Poll recent INBOUND replies (email_type=received). Ungated read; simulates
   * to [] under ticket.dryRun (zero network in local). Fail-closed: returns []
   * on any API error rather than throwing.
   */
  pollInbound(ticket: PolicyTicket, input?: { limit?: number }): Promise<InboundEmail[]>;
```

- [ ] **Step 3: Typecheck** — `npm run typecheck` → FAIL in mocks.ts + real/instantly.ts (method missing). Expected; fixed in Tasks 3–4.

---

### Task 3: Mock `pollInbound` → `[]`

**Files:**
- Modify: `packages/integrations/src/mocks.ts`

- [ ] **Step 1: Add to `createMockInstantly`** (after `pauseLead`, before `verifyWebhookSignature`):

```ts
    async pollInbound(ticket) {
      requireTicket(ticket, "instantly.pollInbound");
      return []; // mock/dry-run surfaces no inbound mail
    },
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` → mocks.ts error resolved (real/instantly.ts still pending).

---

### Task 4: Real `pollInbound` (GET /emails?email_type=received)

**Files:**
- Modify: `packages/integrations/src/real/instantly.ts`
- Test: `packages/integrations/test/real-adapters.test.ts`

- [ ] **Step 1: Write failing tests** (append inside `describe("instantly real adapter", ...)`):

```ts
  it("returns [] under dry-run with zero network", async () => {
    const { impl, calls } = fakeFetch();
    const inst = createInstantlyAdapter({ env: { INSTANTLY_API_KEY: "ik_1" }, fetchImpl: impl }, log);
    const res = await inst.pollInbound(ticket(true), { limit: 50 });
    expect(res).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("polls received emails with bearer auth and normalizes them, live", async () => {
    const { impl, calls } = fakeFetch([
      { items: [
        { id: "em_1", from_address_email: "Lead@Biz.co", body: { text: "Yes please" } },
        { id: "em_2", from_address_email: "two@biz.co", body: { text: "interested" } },
        { id: "", from_address_email: "skip@biz.co", body: { text: "no id" } },
      ] },
    ]);
    const inst = createInstantlyAdapter({ env: { INSTANTLY_API_KEY: "ik_1" }, fetchImpl: impl }, log);
    const res = await inst.pollInbound(ticket(false), { limit: 50 });
    expect(calls[0]!.url).toContain("/api/v2/emails");
    expect(calls[0]!.url).toContain("email_type=received");
    expect(calls[0]!.url).toContain("preview_only=false");
    expect(calls[0]!.headers.authorization).toBe("Bearer ik_1");
    expect(res).toEqual([
      { externalMessageId: "em_1", fromEmail: "lead@biz.co", text: "Yes please" },
      { externalMessageId: "em_2", fromEmail: "two@biz.co", text: "interested" },
    ]);
  });

  it("fails closed to [] on API error", async () => {
    const impl = (async () => new Response("nope", { status: 402 })) as typeof fetch;
    const inst = createInstantlyAdapter({ env: { INSTANTLY_API_KEY: "ik_1" }, fetchImpl: impl }, log);
    expect(await inst.pollInbound(ticket(false), {})).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify failure** — `npm test -- real-adapters` → FAIL (pollInbound not a function).

- [ ] **Step 3: Add imports + the method.** Add `InboundEmail` to the type import, then add the method after `pauseLead` (before `verifyWebhookSignature`):

```ts
    async pollInbound(ticket, input) {
      requireTicket(ticket, "instantly.pollInbound");
      if (ticket.dryRun) return []; // local always dry-run → zero network
      const limit = input?.limit ?? 100;
      // TODO(activation): confirm exact field names + pagination against the live
      // v2 /emails response when the key first runs in staging (mirrors the
      // pauseLead TODO above). email_type=received = inbound replies/responses;
      // preview_only=false returns the full body text.
      const res = await call("GET", `/emails?email_type=received&preview_only=false&limit=${limit}`);
      if (!res.ok) {
        log.warn("instantly pollInbound failed", { status: res.status, traceId: ticket.traceId });
        return []; // fail-closed: never crash the poll loop
      }
      const body = res.body as { items?: unknown[]; data?: unknown[] } | undefined;
      const items = Array.isArray(body?.items) ? body!.items : Array.isArray(body?.data) ? body!.data : [];
      const out: InboundEmail[] = [];
      for (const raw of items) {
        const e = raw as Record<string, unknown>;
        const externalMessageId = String(e.id ?? e.message_id ?? "");
        const fromEmail = String(e.from_address_email ?? e.from_email ?? e.lead ?? e.from ?? "").toLowerCase();
        const bodyObj = e.body as { text?: unknown; html?: unknown } | undefined;
        const text = String(bodyObj?.text ?? bodyObj?.html ?? e.content_preview ?? e.preview ?? "");
        if (!externalMessageId || !fromEmail) continue;
        out.push({ externalMessageId, fromEmail, text });
      }
      return out;
    },
```

Import line change at top:

```ts
import type { InboundEmail, InstantlyAdapter } from "../types";
```

- [ ] **Step 4: Run to verify pass** — `npm test -- real-adapters` → PASS. Then `npm run typecheck` → PASS.

- [ ] **Step 5: Commit** — `feat(integrations): instantly.pollInbound polls received emails`.

---

### Task 5: `instantly.pollReplies` job handler

**Files:**
- Modify: `workers/orchestrator/src/pipelines.ts`
- Test: `workers/orchestrator/test/pipeline.test.ts`

- [ ] **Step 1: Write failing tests** (new describe block):

```ts
describe("instantly reply poller", () => {
  it("enqueues reply.process for known senders, ignores strangers, dedupes", async () => {
    ingestLead(ctx, lead("Poll Biz"));
    await runUntilEmpty(ctx, 100, futureClock);
    const l = ctx.store.leads.list()[0]!;
    const contact = ctx.store.contacts.list({ leadId: l.id })[0]!;

    ctx.integrations.instantly.pollInbound = async () => [
      { externalMessageId: "m1", fromEmail: contact.email, text: "Yes, very interested!" },
      { externalMessageId: "m2", fromEmail: "stranger@nowhere.co", text: "who are you" },
    ];

    ctx.store.queue.enqueue({ type: "instantly.pollReplies", payload: {}, traceId: newTraceId() });
    await runUntilEmpty(ctx, 100, futureClock);

    const events = ctx.store.replyEvents.list({ leadId: l.id });
    expect(events.length).toBe(1);
    expect(events[0]!.externalMessageId).toBe("m1");

    // Re-poll the same message → no duplicate reply.process.
    ctx.store.queue.enqueue({ type: "instantly.pollReplies", payload: {}, traceId: newTraceId() });
    await runUntilEmpty(ctx, 100, futureClock);
    expect(ctx.store.replyEvents.list({ leadId: l.id }).filter((e) => e.externalMessageId === "m1").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- pipeline` → FAIL (no handler for `instantly.pollReplies`).

- [ ] **Step 3: Add the handler** (place near `handleReply`, before `JOB_HANDLERS`):

```ts
const handlePollReplies: JobHandler = async (ctx, job) => {
  const ticket = operationalTicket(ctx, "instantly.pollInbound", { type: "InboundPoll", id: "instantly", leadId: null }, job.traceId);
  const inbound = await ctx.integrations.instantly.pollInbound(ticket, { limit: 100 });
  let enqueued = 0;
  for (const msg of inbound) {
    const contact = ctx.store.contacts.findByKey(`email:${msg.fromEmail.toLowerCase()}`)[0];
    const leadId = contact?.leadId;
    if (!leadId) continue; // not one of our leads — ignore, same as the webhook
    // Dedup: skip messages we already recorded a reply for (serial FIFO queue
    // guarantees the prior reply.process has run before the next poll).
    const seen = ctx.store.replyEvents.list({ leadId }).some((r) => r.externalMessageId === msg.externalMessageId);
    if (seen) continue;
    ctx.store.queue.enqueue({
      type: "reply.process",
      payload: { leadId, text: msg.text, provider: "instantly", externalMessageId: msg.externalMessageId },
      traceId: newTraceId(),
      leadId,
    });
    enqueued++;
  }
  ctx.log.info("instantly poll complete", { fetched: inbound.length, enqueued, traceId: job.traceId });
};
```

- [ ] **Step 4: Register it in `JOB_HANDLERS`** (after `"reply.process": handleReply,`):

```ts
  "instantly.pollReplies": handlePollReplies,
```

- [ ] **Step 5: Run to verify pass** — `npm test -- pipeline` → PASS.

- [ ] **Step 6: Commit** — `feat(orchestrator): instantly.pollReplies ingests polled replies`.

---

### Task 6: Schedule the poll at the configured interval

**Files:**
- Modify: `workers/orchestrator/src/main.ts`

- [ ] **Step 1: Add scheduling** (after the report `setInterval`, before `runForever`):

```ts
if (ctx.config.instantlyPollIntervalMs > 0) {
  const enqueuePoll = () =>
    ctx.store.queue.enqueue({ type: "instantly.pollReplies", payload: {}, traceId: newTraceId() });
  enqueuePoll(); // poll once on startup
  setInterval(enqueuePoll, ctx.config.instantlyPollIntervalMs).unref();
  ctx.log.info("instantly reply polling enabled", { intervalMs: ctx.config.instantlyPollIntervalMs });
}
```

- [ ] **Step 2: Add the import** — add `newTraceId` to the `@william/core` import in main.ts:

```ts
import { loadDotEnv, newTraceId } from "@william/core";
```

- [ ] **Step 3: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 4: Commit** — `feat(orchestrator): schedule instantly reply polling`.

---

### Task 7: Document the env var

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add under the Instantly section:**

```
# How often (ms) to poll Instantly's /emails API for inbound replies — a free
# alternative to the Hypergrowth-gated webhook. 0 (default) disables it.
# Inert in local (dry-run). Example: 300000 = every 5 minutes.
INSTANTLY_POLL_INTERVAL_MS=
```

- [ ] **Step 2: Commit** — `docs: document INSTANTLY_POLL_INTERVAL_MS`.

---

### Task 8: Full suite + compliance review + handoff

- [ ] **Step 1:** `npm test` → all green (was 187; +new). `npm run typecheck` → clean.
- [ ] **Step 2:** `npm run demo` → completes (poller disabled by default; behavior unchanged).
- [ ] **Step 3:** Dispatch `compliance-reviewer` on the diff (reply ingestion + new external read). Apply advisories.
- [ ] **Step 4:** Update CLAUDE.md status section with a "Done (Instantly reply poller)" note and adjust NEXT STEP #1's webhook line to mention the polling alternative.
- [ ] **Step 5: Commit** — `docs: handoff + compliance for instantly reply poller`.

## Self-review

- **Spec coverage:** adapter read (T2–4), job + dedup (T5), scheduling/flag (T1,T6), docs (T7), verification/compliance (T8). Covered.
- **Type consistency:** `InboundEmail { externalMessageId, fromEmail, text }` used identically in type, mock, real, handler, tests. `pollInbound(ticket, {limit?})` signature consistent. `instantly.pollReplies` job type string identical in handler registration, main.ts, and tests.
- **Placeholders:** none — all code shown.
