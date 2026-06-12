# Phase E — Experiment Engine, Weekly Reports, Transcript Ingestion, Owner-Triggered Preview Deploys

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.
> Compact plan (per owner's token-conservation rule); code lives in the diffs.

**Goal:** A/B experiment engine wired to outreach variants, weekly report
rollup that derives DurableLessons, transcript→lesson ingestion through the
existing adapter, and the D4-mandated owner-triggered preview deploys (with
operational-ticket credential plumbing).

**Architecture:** Experiments live in the existing `Experiment`/
`ExperimentResult` schemas (already whitelisted). Engine =
`workers/orchestrator/src/experiments.ts`: deterministic per-lead variant
assignment (hash, no stored assignment row — `OutreachDraft.variant` IS the
record), results computed by joining sent drafts → replyEvents per variant,
upserted per experiment+variant+metric. Weekly report mirrors the daily one
(new `WeeklyReport` entity, Monday rollover in main.ts, on-demand API route).
Transcript ingestion: owner POSTs text → `ingest.transcript` job →
`extractInsights` → `memory.addLesson`. Preview deploys move from
auto-in-handlePreviewBuild to an owner-triggered route + `deploy.preview` job;
`operationalTicket` gains an optional credential pass-through (engine
unchanged — `authorizeOperational` already accepts one).

**Tech stack:** existing monorepo, no new deps.

---

- [x] **Task 1 — Schema + store** (`packages/core/src/schema/memory.ts`,
  `packages/db/src/store.ts`, whitelist in `apps/api/src/server.ts`,
  test `packages/db/test/store.test.ts`): add `"design"` to
  `DurableLesson.topic` enum (designReferences.ts documents this intent);
  new `WeeklyReport` entity { weekStart/weekEnd (YYYY-MM-DD regex), summary,
  metrics record(number), wins/bottlenecks/lessons/experimentFindings string
  arrays (default []), reportText }. Repo `weeklyReports` (collection
  `weekly_reports`, skey weekStart); whitelist `"weekly-reports"`. Test:
  round-trip + skey lookup.
- [x] **Task 2 — First-touch variant registry** (`workers/outreach/src/draft.ts`,
  new test `workers/outreach/test/draft.test.ts`): export
  `FIRST_TOUCH_VARIANTS = ["v1-cornell-mockup", "v2-finding-first"]`.
  v2 leads with the audit finding, intro second; same owner-specified
  mockup claim (B1 wording kept verbatim), same opt-out line, subject ≤70.
  Unknown variant → v1 content + personalization note (never throw mid-
  pipeline). Tests: both variants pass `validateDraft`; v2 ≠ v1 subject+body;
  fallback note on unknown variant.
- [x] **Task 3 — Experiment engine** (new
  `workers/orchestrator/src/experiments.ts`, new test
  `workers/orchestrator/test/experiments.test.ts`; wire in `pipelines.ts`
  handleDraft): `runningExperiment(ctx, dimension)`;
  `assignVariant(experiment, leadId)` — FNV-1a hash of
  `${experiment.id}:${leadId}` mod variants.length (deterministic,
  idempotent); `computeExperimentResults(ctx, experiment)` — outreach_variant:
  per variant sends (sent drafts, variant match), replies + positive_replies
  (replyEvents joined via the lead's sent draft variant), reply_rate;
  upsert one ExperimentResult per experiment+variant+metric (period =
  experiment.createdAt→now); `experimentFindings(ctx)` — human strings for
  reports. handleDraft: running outreach_variant experiment →
  `variant: assignVariant(...)` else default. Tests: assignment stable +
  spreads across variants; results math against seeded drafts/replies;
  upsert doesn't duplicate; handleDraft uses assigned variant.
- [x] **Task 4 — Experiments API + dashboard + demo seed**
  (`apps/api/src/server.ts` + `apps/api/test/server.test.ts`,
  `apps/dashboard/src/App.tsx` + new `apps/dashboard/src/pages/Experiments.tsx`,
  `workers/orchestrator/src/demo.ts` seed): `POST /api/experiments`
  (name/hypothesis required, dimension via zod enum, variants ≥2; when
  dimension=outreach_variant every variant must be in FIRST_TOUCH_VARIANTS)
  → insert status "running" + audit; `POST /api/experiments/:id/compute` →
  results; `POST /api/experiments/:id/conclude` { status:
  concluded|abandoned, conclusion } → final compute + save + audit.
  Dashboard: dedicated Experiments page (create form, results table,
  compute/conclude buttons) replacing the generic config entry. Demo/seed:
  one running outreach_variant experiment so `npm run demo` exercises
  assignment. Tests: create → next draft gets assigned variant; invalid
  variant 400; conclude persists conclusion + results.
- [x] **Task 5 — Weekly report** (`workers/orchestrator/src/reports.ts`,
  `workers/orchestrator/src/main.ts`, `apps/api/src/server.ts`, tests in
  `workers/orchestrator/test/pipeline.test.ts`):
  `generateWeeklyReport(ctx, weekEnding = today)` — window = weekEnding−6d;
  aggregate dailyMemories in window + current metrics + failures-by-category
  (createdAt in window) + `experimentFindings` + open OwnerRequests; derive
  lessons via `memory.addLesson`: variant leader when every variant has ≥10
  sends (topic "outreach"), failure category ≥5 in window (topic "process");
  upsert WeeklyReport by weekStart; markdown reportText like daily.
  main.ts: on day rollover, if new day is Monday → weekly for week ending
  Sunday. API: `GET /api/reports/weekly`. Tests: sections + metrics from
  seeded data; lesson thresholds (9 sends → no lesson, 10 → lesson);
  re-run upserts (no duplicate rows).
- [x] **Task 6 — Transcript ingestion** (`apps/api/src/server.ts`,
  `workers/orchestrator/src/pipelines.ts`, tests in server.test.ts +
  pipeline.test.ts): `POST /api/transcripts` { source, text } (non-empty
  strings, text ≤100k chars) → enqueue `ingest.transcript` + kickQueue →
  202 { jobId }. Handler: `ctx.integrations.transcripts.extractInsights` →
  `memory.addLesson` per insight (adapter topic mapped into the enum —
  "design" now valid, unknown → "other"; evidence `transcript:<source>`);
  audit `transcript.ingested` with insight count; zero insights → audit
  notes what qualifies (blocked ≠ stuck). Transcript text is owner-provided
  DATA — stored/quoted, never executed (invariant 1 applies). Tests: POST →
  lessons exist with topic design; empty text 400.
- [x] **Task 7 — Owner-triggered preview deploys** (resolves TODO(phase-e) at
  `pipelines.ts:715` + compliance advisory D4;
  `workers/orchestrator/src/context.ts`, `apps/api/src/server.ts`,
  `apps/dashboard/src/pages/LeadDetail.tsx`): REMOVE the auto preview-deploy
  block from handlePreviewBuild. `operationalTicket(ctx, action, subject,
  traceId, credential?)` passes the credential through instead of `null`
  (engine unchanged; local stays forced dry-run by config). New route
  `POST /api/site-projects/:id/deploy-preview` → 409 when no
  previewPath/buildPath, else enqueue `deploy.preview` { siteProjectId }.
  New handler: vercel credential status → operationalTicket with it →
  `vercel.deploy(target preview)` → recordDeployment + previewUrl +
  activity. LeadDetail: "Deploy preview" button beside request-deploy.
  Tests: preview build creates NO deployment record; route + job → dry_run
  deployment in local; missing-artifact 409.
- [x] **Task 8 — Follow-up gate decision** (`pipelines.ts:501`): keep the
  shared SEND_FIRST_TOUCH gate — same risk class, per-draft owner approval,
  autopilot coverage intentionally shared. Replace TODO with the decision
  note; reflect in CLAUDE.md + handoff.
- [x] **Task 9 — Verify + ship**: compliance-reviewer subagent on the diff
  (outreach v2 copy, experiment→outreach wiring, preview-deploy trigger +
  operational-ticket credential plumbing, new routes) — mandatory;
  `npm test`, `npm run typecheck`, `npm run demo`; commit + push; update
  CLAUDE.md status + handoff.md + auto-memory.

**Out of scope (stay deferred):** Instantly pauseLead verification (needs a
real key), LLM reply classification (no LLM credential; classify.ts heuristics
remain), Vercel framework-detection verification (needs token).

**Outcome:** All tasks complete. 132/132 tests green, typecheck clean,
`npm run demo` verified (0 dead jobs), dashboard builds. Compliance review
7/7 PASS (advisories: B1 stands as owner-accepted; LLM transcript extractor
must return through compliance review when it lands; replyEvents status→intent
mapping confirmed correct at store.ts:144).
