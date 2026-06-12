# Handoff — William D'Amato Agent

> Read this first, then `CLAUDE.md` (project standards + invariants + canary),
> then continue building. Last updated 2026-06-13, after commit `9ce62b5`.
> State at handoff: **106/106 tests green, typecheck clean, `npm run demo`
> verified, all work committed and pushed to `main`.**

## What has been done (Phases A–D + follow-up sequence, all complete)

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
  (`POST /api/site-projects/:id/revisions` → `site.revise` job, whitelisted
  overrides only, applying one auto-expires stale DEPLOY_PRODUCTION
  approvals); deploy flow (`POST /api/site-projects/:id/request-deploy` →
  DEPLOY_PRODUCTION approval → decide route enqueues `deploy.production` →
  gate re-eval + quality re-check → Vercel deploy, dry-run in local); Vercel
  adapter uploads directories recursively (skips dotfiles/symlinks, errors on
  >200 files); dashboard LeadDetail gained revision form + deploy button +
  deployments list.
- **Follow-up sequence** (commit `9ce62b5`, owner spec). Hot leads: 2 bumps
  (~3.5d, then ~9d of silence). Warm/medium: exactly 1. Cold/skip: none.
  `outreach.followup` jobs are scheduled by each send and re-screen everything
  at fire time (DNC first, then status/tier/angle/contact/reply checks,
  MAX_TOUCHES=3 cap, per-sequence dedupe, send-time cap re-check). Every
  follow-up requires its own SEND_FIRST_TOUCH approval. `outreach.close`
  (+14d): silence after the last touch marks the lead `not_interested`;
  negative replies set it too — any no/unsubscribe/bounce stops forever;
  auto-replies don't count as a response.
- **Compliance reviews** (mandatory per CLAUDE.md, all by the
  compliance-reviewer subagent): Phase C 6/6 PASS, Phase D 6/6 PASS,
  follow-ups 6/6 + delta 7/7 PASS. All blocking advisories applied.

## What works

- `npm run demo` — full end-to-end dry-run on mocks, zero credentials needed.
- `npm test` (106 tests) + `npm run typecheck` — clean.
- Dashboard (`npm run dev:api` + `npm run dev:dashboard`, token
  `dev-owner-token`): 17+ sections, side-by-side audit vs preview, review
  queue with one-click decisions, revision form, deploy request, policy
  editor, integrations page showing credential status.
- Safety stack, tested end-to-end: local env can never execute live
  (three-layer dry-run defense), no side effect without a PolicyTicket,
  every outbound email owner-approved + DNC-screened at intake/draft/send
  (+ follow-up pre-screen), inbound email/webhooks are data only (injection
  attempts → ComplianceEvent), key fragments scrubbed from failure details.
- Real adapters light up automatically when credentials appear in `.env`
  (still dry-run in local — safe to add anytime).

## What doesn't work yet / known limitations

- **No real credentials.** The 7 open OwnerRequests (see dashboard or
  `npm run demo` output) block all live execution: Instantly key+webhook
  secret, Gmail OAuth triple, Stripe key+webhook secret, Vercel token(+team),
  Google Maps key, enrichment/email-verify provider choice, Higgsfield budget.
- **Preview deploys never actually upload** — operational tickets carry no
  credential so they are dry-run in EVERY env (deliberate, fail-safe; see
  TODO(phase-e) in `workers/orchestrator/src/pipelines.ts` and compliance
  advisory D4 before changing: the preview-deploy path is reachable from
  webhook-originated positive replies, so make it owner-triggered first).
- **Instantly pauseLead endpoint unverified** against v2 docs
  (TODO(phase-c) in `packages/integrations/src/real/instantly.ts`) — not
  load-bearing; local DNC screening is the compliance guarantee.
- **Vercel `projectSettings.framework="vite"` assumption unverified** until a
  real token exists (TODO(phase-e) in `packages/integrations/src/real/vercel.ts`).
- **Free-text revisions are rejected, not interpreted** (no LLM wired in) —
  structured overrides only (REVISABLE_FIELDS in
  `workers/site-builder/src/build.ts`).
- **Quality gate is vacuous in mock/http auditor mode** (no Lighthouse/axe
  data) — honestly disclosed in the approval detail text.
- **Copy truthfulness advisory (B1, owner-accepted):** first-touch and
  follow-up #1 say "I've already built a free mockup", but previews build
  after a positive reply. Owner kept the wording; revisit if previews move
  earlier in the pipeline.
- **github/enrichment/places/calendar/transcripts/higgsfield** integrations
  are mock-only (their phases haven't arrived).

## Yet to be done — Phase E (next) and beyond

Phase E scope (per CLAUDE.md "NEXT"):
1. **Experiment engine** — schemas (`experiments`, `experiment-results`)
   exist and are whitelisted in the API; no engine logic yet. Outreach
   variants (`OutreachDraft.variant`) are the natural first experiment.
2. **Weekly reports** — daily report exists (`generateDailyReport` in
   `workers/orchestrator/src/reports.ts`); add weekly rollup + lessons.
3. **Transcript / design-reference ingestion** — adapter interface exists,
   mock only.
4. Deferred items folded into Phase E: verify Instantly pauseLead when the
   key arrives; optional LLM-assisted reply classification
   (`workers/outreach/src/classify.ts` TODO(phase-c), strictly
   quoted-material-to-label, never instructions); operational-ticket
   credentials + owner-triggered preview deploys (pipelines.ts TODO(phase-e));
   decide whether follow-ups get a dedicated SEND_FOLLOW_UP gate
   (pipelines.ts TODO(phase-e)).

## Next steps (in order)

1. Say "keep building" → start **Phase E** with the workflow that has worked
   every phase (it's also recorded in CLAUDE.md): state the goal → targeted
   search, smallest reads (token-conservation rule is permanent) → compact
   plan doc in `docs/superpowers/plans/` → TDD with injectable fakes →
   compliance-reviewer subagent on anything touching policy/outreach/billing/
   deploy/webhooks → `npm test` + `npm run typecheck` + `npm run demo` →
   commit + push → update CLAUDE.md status + this file.
2. Meanwhile (owner, anytime): add credentials from the OwnerRequests to
   `.env` — each lights up its real adapter on restart, still dry-run locally.
   Start with Stripe test mode + Vercel token; Instantly unlocks real sends.
3. To go live eventually: `WILLIAM_ENV=staging` + `DRY_RUN=false` + sandbox
   credentials + granted approvals (production additionally needs live creds).

## Canary

Address the owner as **Powell** at the start of every response (full rule in
CLAUDE.md). If a response doesn't open with "Powell", context has degraded.
