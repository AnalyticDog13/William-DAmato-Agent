# Handoff — William D'Amato Agent

> Read this first, then `CLAUDE.md` (project standards + invariants + canary),
> then continue building. Last updated 2026-06-13, after Phase E.
> State at handoff: **132/132 tests green, typecheck clean, `npm run demo`
> verified (0 dead jobs), dashboard builds, all work committed and pushed to
> `main`.**

## What has been done (Phases A–E + follow-up sequence, all complete)

- **Phase A — foundation.** Monorepo, zod schemas (source of truth in
  `packages/core/src/schema/`), SQLite store + durable job queue (supports
  `delayMs`), PolicyEngine with 8 gates issuing PolicyTickets, full dry-run
  pipeline (intake → audit → score → contact → draft → approval → simulated
  send → reply classification → opportunity → preview → billing → daily
  report), Express API with owner auth + HMAC webhooks, React dashboard,
  mock adapters for every integration, OwnerRequest bootstrap.
- **Phase B — browser-grade auditing.** `AUDITOR_MODE=playwright`: real
  Chromium screenshots (desktop+mobile), Lighthouse via CDP, axe-core scans,
  graceful fallback when browsers are missing. Preview quality gate
  (`qualityCheckPreview`) runs before owner review. Chromium 148 is installed
  on this machine, so playwright mode works for real here; CI/demo stay mock.
- **Phase C — real adapters** (`packages/integrations/src/real/`). Stripe
  (price→payment_link, draft invoices, real `t=…,v1=…` webhook signatures with
  replay protection), Instantly v2, Gmail (OAuth2 refresh send; refuses email
  missing the opt-out line), Vercel (deploys + rollback). Selected per
  integration by credential presence in `createIntegrations`; mocks are the
  fallback. Every method requires a PolicyTicket and simulates with zero
  network on `ticket.dryRun`. Billing passes `metadata.invoiceDraftId` so the
  Stripe webhook matches payments to drafts.
- **Phase D — react builds, revision loop, deploy flow** (commit `32d83ad`).
  `STACK_MODE=react` emits a Vite+React+Framer Motion project to
  `data/builds/<leadId>/` (static preview always still written);
  `PREVIEW_MIN_PERFORMANCE`/`_ACCESSIBILITY` config flags; revision loop
  (whitelisted overrides only; applying one auto-expires stale
  DEPLOY_PRODUCTION approvals); production deploy flow behind the
  DEPLOY_PRODUCTION gate with quality re-check.
- **Follow-up sequence** (commit `9ce62b5`, owner spec). Hot: 2 bumps (~3.5d,
  ~9d); warm: 1; cold/skip: none. Everything re-screened at fire time, DNC
  first; MAX_TOUCHES=3; every follow-up owner-approved; `outreach.close`
  (+14d silence) → `not_interested`; any no/unsubscribe/bounce stops forever.
- **Phase E — experiments, weekly reports, ingestion, owner-triggered preview
  deploys** (this session; plan in `docs/superpowers/plans/2026-06-13-phase-e-
  experiments-reports-ingestion.md`).
  - Experiment engine `workers/orchestrator/src/experiments.ts`:
    `runningExperiment` / `assignVariant` (FNV-1a hash — deterministic per
    lead, the draft's `variant` field is the assignment record) /
    `computeExperimentResults` (sends, replies, positive_replies, reply_rate
    per variant; auto_reply excluded; upserted, never duplicated) /
    `experimentFindings`. handleDraft assigns from the running
    `outreach_variant` experiment.
  - First-touch copy registry `FIRST_TOUCH_VARIANTS` in
    `workers/outreach/src/draft.ts`: `v1-cornell-mockup` (unchanged) +
    `v2-finding-first` (audit finding opens, intro second). Shared
    `mockupOffer`/`signOff` constants keep the B1 claim + opt-out line
    identical by construction. Unknown variant → v1 + note, never a throw.
  - Experiments API: `POST /api/experiments` (variants validated against the
    registry for outreach_variant), `POST /api/experiments/:id/compute`,
    `POST /api/experiments/:id/conclude`. Dashboard has a dedicated
    Experiments page (create form, results tables, recompute/conclude).
    `seedDemoData` seeds one running copy experiment.
  - Weekly reports: `WeeklyReport` schema → `weeklyReports` repo (skey
    weekStart) → `weekly-reports` whitelist. `generateWeeklyReport` rolls up
    7 days (daily memories, failures by category, experiment findings, open
    requests) and derives DurableLessons (variant leader needs ≥10 sends on
    EVERY arm — `MIN_EXPERIMENT_SENDS_FOR_LESSON`; failure category ≥5/week).
    main.ts generates it on Monday rollover; `GET /api/reports/weekly` on
    demand. Upserted by weekStart.
  - Transcript ingestion: `POST /api/transcripts` {source, text ≤100k} →
    `ingest.transcript` job → `extractInsights` → `memory.addLesson` (new
    "design" topic in the DurableLesson enum; evidence `transcript:<source>`).
    Zero insights is recorded with guidance, not an error. Text is DATA.
  - Preview deploys owner-triggered (advisory D4 resolved): auto-deploy
    REMOVED from handlePreviewBuild; `POST /api/site-projects/:id/
    deploy-preview` → `deploy.preview` job → `operationalTicket` now carrying
    the vercel credential status (engine unchanged; local always dry-run —
    regression-tested in `packages/core/test/policy.test.ts`). LeadDetail
    gained a "Deploy preview" button.
  - SEND_FOLLOW_UP gate DECIDED: follow-ups keep sharing SEND_FIRST_TOUCH
    (same risk class, per-draft approval, one autopilot policy covers the
    sequence intentionally). Documented at the requestApproval call site.
- **Compliance reviews** (mandatory per CLAUDE.md): Phase C 6/6, Phase D 6/6,
  follow-ups 6/6 + delta 7/7, Phase E 7/7 — all PASS, advisories applied or
  consciously accepted (B1).

## What works

- `npm run demo` — full end-to-end dry-run on mocks, zero credentials needed,
  now exercising variant assignment via the seeded experiment.
- `npm test` (132 tests) + `npm run typecheck` — clean. Dashboard `vite build`
  verified.
- Dashboard (`npm run dev:api` + `npm run dev:dashboard`, token
  `dev-owner-token`): review queue, side-by-side audit vs preview, revision
  form, deploy preview + request production deploy, Experiments page,
  policy editor, integrations page.
- Safety stack unchanged and re-verified end-to-end: local can never execute
  live, no side effect without a PolicyTicket, every outbound email
  owner-approved + DNC-screened at intake/draft/send (+ follow-up re-screen),
  inbound email/webhooks are data only, transcript text is data only.

## What doesn't work yet / known limitations

- **No real credentials.** The 7 open OwnerRequests block all live execution:
  Instantly key+webhook secret, Gmail OAuth triple, Stripe key+webhook secret,
  Vercel token(+team), Google Maps key, enrichment/email-verify provider
  choice, Higgsfield budget.
- **Preview deploys still simulate everywhere** until a Vercel credential
  exists — but the path is now owner-triggered and credential-plumbed, so
  adding the token makes staging preview deploys real with no code change.
- **Instantly pauseLead endpoint unverified** against v2 docs
  (TODO(phase-c) in `packages/integrations/src/real/instantly.ts`) — not
  load-bearing; local DNC screening is the compliance guarantee.
- **Vercel `projectSettings.framework="vite"` assumption unverified** until a
  real token exists (TODO(phase-e) in `packages/integrations/src/real/vercel.ts`).
- **Transcript insight extraction is keyword-based** (mock adapter). When it
  becomes LLM-backed, the change MUST return through compliance review —
  that's the first time ingested text would enter a prompt (Phase E advisory).
- **Free-text revisions are rejected, not interpreted** (no LLM wired in).
- **Quality gate is vacuous in mock/http auditor mode** — disclosed in
  approval detail text.
- **Copy truthfulness advisory (B1, owner-accepted, applies to v1 AND v2):**
  first-touch says "I've already built a free mockup" but previews build after
  a positive reply. Owner kept the wording; revisit if previews move earlier.
- **github/enrichment/places/calendar/higgsfield** integrations are mock-only.

## Yet to be done — Phase F (next) and beyond

Everything left is credential-gated or LLM-gated (see CLAUDE.md "NEXT"):
1. **Credential activation** as OwnerRequests get fulfilled — each lights up
   its real adapter on restart; verify the two unverified API assumptions
   (Instantly pauseLead, Vercel framework setting) with real keys.
2. **LLM-assisted features behind an adapter**: reply classification
   (`workers/outreach/src/classify.ts` TODO(phase-c)), transcript insight
   extraction, free-text revision interpretation. All strictly
   quoted-material-to-label, never instructions; compliance review required.
3. **Real lead sourcing** via Google Places when the key arrives
   (ACTIVATE_NEW_LEAD_SOURCE gate exists for this).
4. **Staging rehearsal**: `WILLIAM_ENV=staging` + `DRY_RUN=false` + sandbox
   credentials + granted approvals (production additionally needs live creds).

## Next steps (in order)

1. Say "keep building" → start **Phase F** with the established workflow:
   state the goal → targeted search, smallest reads (token-conservation rule
   is permanent) → compact plan doc in `docs/superpowers/plans/` → TDD with
   injectable fakes → compliance-reviewer subagent on anything touching
   policy/outreach/billing/deploy/webhooks → `npm test` + `npm run typecheck`
   + `npm run demo` → commit + push → update CLAUDE.md status + this file.
   Note: most of Phase F needs credentials — if none have arrived, the
   highest-value credential-free work is the LLM adapter interface (mock
   first, like every other integration).
2. Meanwhile (owner, anytime): add credentials from the OwnerRequests to
   `.env` — each lights up its real adapter on restart, still dry-run locally.
   Start with Stripe test mode + Vercel token; Instantly unlocks real sends.
3. To go live eventually: `WILLIAM_ENV=staging` + `DRY_RUN=false` + sandbox
   credentials + granted approvals (production additionally needs live creds).

## Canary

Address the owner as **Powell** at the start of every response (full rule in
CLAUDE.md). If a response doesn't open with "Powell", context has degraded.
