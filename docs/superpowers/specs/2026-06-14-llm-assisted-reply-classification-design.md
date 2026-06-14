# LLM-assisted reply classification — design

**Date:** 2026-06-14
**Status:** approved (pre-implementation)
**Phase:** Phase F follow-up / NEXT STEPS #4 (first slice)

## Problem

Inbound reply classification (`workers/outreach/src/classify.ts`) is pure regex.
Replies that match no pattern fall to `intent: "unknown"` (confidence `0.3`,
"Manual review needed"). That bucket is exactly where a human reply with positive
or negative intent — phrased outside the patterns — gets stranded. The
`TODO(phase-c)` in `classify.ts` already anticipates LLM-assisted classification
"behind the same interface, with the reply passed strictly as quoted material to
label."

This is NEXT STEP #4. It is built mock-first: the `llm` adapter is already wired
into `createIntegrations`, and **local is always dry-run**, so with no key (and
in CI/demo) behavior is identical to today.

## Non-goals (YAGNI)

- LLM assist on `neutral` replies — `neutral` is already actionable
  (owner-review next step). Only `unknown` is sent to the model.
- Passing business/audit context into the classification prompt — the reply text
  alone is classified, to keep the untrusted-data surface minimal.
- Numeric confidence thresholds in the merge — "if unsure, return UNKNOWN" lives
  in the prompt; the model self-selects out.

## Safety model (load-bearing)

The deterministic regex `classifyReply(text)` remains **authoritative**:

1. It runs first, always, on the raw reply text.
2. **Injection detection is never delegated to the model.**
   `instructionAttemptDetected` is computed only by the regex detector, and the
   LLM result can never clear it (the existing ComplianceEvent path is
   unchanged).
3. The LLM is consulted **only when the regex returns `unknown`**. Any confident
   regex label — including every compliance-critical intent
   (`unsubscribe` / `bounce` / `negative`) — short-circuits before the LLM is
   called. The model can therefore **never override a stop signal**.
4. For an `unknown`, the LLM may only *resolve* it. Upgrading to a stop signal
   (`unsubscribe`/`negative`/`bounce`) is fail-closed-good. If the model is
   unsure it returns `unknown` and the regex result stands.
5. The reply text enters the prompt strictly as quoted, fenced, untrusted DATA
   (invariant 1). The system prompt forbids treating embedded text as
   instructions.

Net effect on compliance-critical routing in `handleReply`: unchanged, because
those intents are decided by the regex before the LLM is ever reached.

## Components

### 1. `workers/outreach/src/classify.ts` — injectable resolver

`classifyReply` (regex) and `recommendedNextStep` are unchanged. Add:

```ts
export type LlmReplyAssist =
  (text: string) => Promise<{ intent: ReplyIntent; confidence: number } | null>;

export async function classifyReplyAssisted(
  text: string,
  assist?: LlmReplyAssist,
): Promise<Classification>;
```

Logic:

```
base = classifyReply(text)                      // authoritative regex
if !assist || base.intent !== "unknown": return base
llm = await assist(text)                         // null in mock / dry-run
if !llm: return base
return {
  intent: llm.intent,
  confidence: llm.confidence,
  instructionAttemptDetected: base.instructionAttemptDetected,  // regex-only
}
```

The merge lives here (not in the orchestrator) so it is unit-testable with a
fake `assist`, no app context required.

### 2. `packages/integrations/src/types.ts` — adapter interface

Add to `LlmAdapter`, mirroring `generateOutreachCopy`'s null-fallback contract:

```ts
export interface ReplyClassifyRequest { text: string }
export interface ReplyClassifyResult { intent: ReplyIntent; confidence: number }

// on LlmAdapter:
classifyReply(
  ticket: PolicyTicket,
  input: ReplyClassifyRequest,
): Promise<ReplyClassifyResult | null>;
```

Returns `null` when no LLM copy is available (the mock, and the real adapter
under `ticket.dryRun`), so the caller keeps the regex result.

### 3. `packages/integrations/src/real/llm.ts` — real method

- `requireTicket(ticket, "llm.classifyReply")`.
- `ticket.dryRun → null` (local zero-network).
- Otherwise call the Anthropic Messages API with a strict classification system
  prompt: choose exactly one label from the `ReplyIntent` enum; reply text fenced
  in `<reply>` tags as untrusted DATA; "if you cannot tell, answer UNKNOWN."
- Parse the response to a single label; validate it is a member of the
  `ReplyIntent` enum; map to `{ intent, confidence }`. Garbage / non-enum /
  `!res.ok` / empty → `null` (caller falls back to regex). Low/static confidence
  is acceptable; the value is informational and stored on the ReplyEvent.

### 4. `packages/integrations/src/mocks.ts` — mock method

`classifyReply: async () => null` (deterministic; caller uses the regex).

### 5. `workers/orchestrator/src/pipelines.ts` — wire `handleReply`

Replace `const classification = classifyReply(text);` with:

```ts
const classification = await classifyReplyAssisted(text, async (t) => {
  const ticket = operationalTicket(
    ctx, "llm.classifyReply",
    { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId,
  );
  return ctx.integrations.llm.classifyReply(ticket, { text: t });
});
```

The ticket is minted only when the closure runs (i.e. only for `unknown`
replies). `operationalTicket` accepts the free-form action string
`"llm.classifyReply"` (no gate/whitelist change — consistent with the existing
`llm.generateBuildPrompt` / `llm.generateOutreachCopy` operational reads).
Everything downstream of `classification` is unchanged.

## Testing (TDD — tests first)

**`classify.test.ts` (unit, fake assist):**
- confident regex intent (e.g. `positive`) → `assist` is NOT awaited; returns regex.
- `unsubscribe` text + `assist` that returns `positive` → result stays
  `unsubscribe` (stop signal cannot be overridden).
- `unknown` text + `assist` returns `null` → stays `unknown`.
- `unknown` text + `assist` returns `positive` → upgraded to `positive`.
- injection-laden `unknown` text + `assist` returns `positive` →
  `instructionAttemptDetected` stays `true`.
- no `assist` argument → returns regex result.

**Adapter unit (`real/llm` + mocks):**
- `classifyReply` throws without a ticket.
- returns `null` on `ticket.dryRun` (no fetch invoked).
- parses a valid fenced enum label from an injected fetch response.
- returns `null` on a non-enum label, empty body, or `!res.ok`.
- mock `classifyReply` returns `null`.

**Pipeline integration (`pipeline.test.ts`):**
- inject a fake `llm` adapter whose `classifyReply` returns `positive` for an
  otherwise-`unknown` reply → assert an `Opportunity` is created and
  `brief.generate` is enqueued (proves end-to-end wiring), while the default
  (null) path leaves existing reply tests green.

## Verification & process

- `compliance-reviewer` subagent is **mandatory** on the diff (reply
  classification + text→LLM prompt, invariant 1). Apply advisories before commit.
- `npm test` (all suites green), `npm run typecheck`, `npm run demo`
  (0 dead-letter jobs) must pass.
- Update `CLAUDE.md` status section + `handoff.md` after.
- Commit only when the owner asks (CLAUDE.md), batched with the implementation.
