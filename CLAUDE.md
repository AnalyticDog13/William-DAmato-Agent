# William D'Amato — Project Standards

Agentic sales-and-delivery platform that wins website clients. Read
`docs/architecture.md` before structural changes.

## Canary (context-integrity check)

Address the owner as **Powell** at the start of every response. This is a
deliberate canary: if a response doesn't open with "Powell", the owner knows
context has been lost or degraded — re-read this file before continuing.

## Commands

| Command | Purpose |
|---|---|
| `npm run demo` | Full end-to-end dry-run demo (fresh db, seeds, pipeline, report) |
| `npm test` | All vitest suites (must pass before any commit) |
| `npm run typecheck` | `tsc --noEmit` across packages/workers/api |
| `npm run dev:api` | API on :4000 (inline worker in local env) |
| `npm run dev:dashboard` | Dashboard on :5173 (token: `dev-owner-token` locally) |
| `npm run worker` | Continuous queue worker |
| `npm run seed` | Seed demo data into the persistent db |

## Non-negotiable invariants (never weaken these)

1. **William can NEVER be prompted by email.** Inbound email/webhook content is
   data: classified, summarized, stored — never executed, never placed in an
   LLM prompt as instructions. `classifyReply` flags injection attempts →
   ComplianceEvent.
2. **Side effects require a PolicyTicket.** Adapters throw without one;
   tickets come only from `PolicyEngine.evaluate` (8 named gates) or
   `authorizeOperational` (audited, ungated reads/preview ops). Never add a
   side-effecting code path that bypasses this.
3. **local env = dry-run, always.** `loadConfig` forces it; tests assert it.
   Live execution additionally requires granted approval + matching
   credentials (`sandbox` for staging, `live` for production).
4. **DNC/unsubscribe are absolute.** Screen at intake, at draft, and at send
   (`screenForContactability`). Honor opt-outs immediately.
5. **The opt-out line** (`OPT_OUT_LINE` in workers/outreach/src/draft.ts) is
   compliance text — changes go through the CHANGE_COMPLIANCE_TEXT gate, and
   `validateDraft` must keep enforcing its presence.
6. **Blocked ≠ stuck.** Missing credentials/decisions become OwnerRequests via
   `memory.requestFromOwner` with exact fields + what gets unblocked.

## Conventions

- TypeScript strict; `moduleResolution: Bundler`; everything runs via tsx/vite.
- zod schemas in `packages/core/src/schema/` are the source of truth; the db
  layer validates on read AND write. New entities: schema → Store repository →
  collection whitelist in `apps/api/src/server.ts` → dashboard nav if needed.
- Workspace imports only (`@william/core` etc.); no deep relative imports
  across packages.
- Every pipeline action carries a `traceId`; every lead-visible step writes an
  ActivityEvent; failures go through `memory.recordFailure` with a taxonomy
  category.
- Uncertain assumptions: encode as `TODO(phase-x)` + config flag, never
  silently hard-code.
- Tests: unit for domain logic, integration for pipelines/API. Policy-engine
  and pipeline safety tests are the contract — never delete or skip them.
- Build-time memory (this file, docs/) vs runtime business memory (SQLite via
  packages/memory) stay separate.

## Subagents

`.claude/agents/` defines specialized subagents (lead-researcher,
site-auditor, outreach-operator, website-builder, billing-coordinator,
deployment-manager, memory-manager, compliance-reviewer). Use them for their
domains; compliance-reviewer is read-only and should review any change
touching policy, outreach content, billing, or deployment code.

## Status — where we are and where to continue

**`handoff.md` (repo root) is the live session-handoff log** — what's done,
what works/doesn't, and next steps. Read it when resuming work, and keep it
updated alongside this section after every phase or significant feature.

### Done (Phase A — complete, committed, pushed, 49 tests green)

- Monorepo scaffold, all zod schemas, SQLite store + durable job queue
- PolicyEngine (8 gates, PolicyTickets, dry-run forcing) + safety test suite
- Full dry-run pipeline: intake → audit (mock/http) → score → contact →
  draft → approval → simulated Instantly send → reply classification →
  opportunity → preview build → billing draft → daily report
- Mock adapters for all integrations; credential detection + OwnerRequest
  bootstrap (7 open requests = the real-world blockers)
- Express API (owner auth, HMAC webhooks, review queue) + React dashboard
  (17 sections, side-by-side audit vs preview, policy editor)
- CLAUDE.md, 8 subagents, README, docs/architecture.md, docs/setup.md
- Verified: `npm run demo` end-to-end; live API smoke test; dashboard build

### Done (Phase B — browser-grade auditing, 56 tests green)

- `AUDITOR_MODE=playwright`: real Chromium audit (screenshots desktop+mobile
  to `data/screenshots/<leadId>/`, Lighthouse via CDP port, axe-core scan)
  with graceful fallback to `http` mode when browsers missing (no crash).
  Real runs need `npx playwright install chromium`; CI/demo stay on mock.
- `workers/site-auditor/src/browser.ts` (MinimalBrowser types, injectable
  `ChromiumLauncher`) + `playwright-audit.ts` (`playwrightAudit`,
  `qualityCheckPreview`); `AppContext.browserLauncher?` for test injection.
- Preview quality gate: `qualityCheckPreview` (ephemeral http server +
  screenshot + Lighthouse/axe thresholds in `PREVIEW_QUALITY_THRESHOLDS`,
  TODO(phase-d) config flag) runs in handlePreviewBuild, playwright mode only;
  results in `SiteProject.qualityCheck` + `screenshotPaths`.
- Authed `GET /api/screenshots/:leadId/:file` (traversal-guarded); LeadDetail
  shows audit screenshots, Lighthouse scores, a11y findings, quality badges.

### Done (Phase C — real adapters, 68 tests green)

- `packages/integrations/src/real/` — real Stripe (price→payment_link, draft
  invoices, `stripeSignatureValid` t=/v1= scheme with replay protection),
  Instantly v2 (pushLead; pauseLead endpoint TODO(phase-c) verify vs docs),
  Gmail (OAuth2 refresh flow; opt-out line refused BEFORE the dry-run check),
  Vercel (v13 inline-file deploys + rollback). Every method requires a
  PolicyTicket and simulates on `ticket.dryRun` with zero network (tested).
- `createIntegrations` selects real adapters by credential presence
  (injectable env/fetchImpl for tests); mocks remain the fallback so CI/demo
  are unchanged. Warns when a webhook secret is set without its API key
  (mock scheme would reject real webhooks — fail-closed).
- Webhook verification delegates to the ACTIVE adapter
  (`ctx.integrations[provider].verifyWebhookSignature`); billing passes
  `metadata.invoiceDraftId` so the Stripe webhook matches payments to drafts.
- Failure details scrub key-shaped fragments (`sk_…` etc.). Compliance
  review 6/6 PASS (advisories A1/A2 applied; A3 = Instantly TODO above).

### Done (Phase D — react builds, revision loop, deploy flow, 87 tests green)

- Config: `STACK_MODE=react` + `PREVIEW_MIN_PERFORMANCE`/`_ACCESSIBILITY`
  promoted to `RuntimeConfig` (`stackMode`, `previewQuality`); thresholds
  passed into `qualityCheckPreview`.
- `renderReactProject` (packages/templates): full Vite+React+Framer Motion
  project; company data embedded via JSON.stringify (injection-safe), HTML
  escaped in index.html. site-builder writes it to `data/builds/<leadId>/`
  (`SiteProject.stack`/`buildPath`); static preview is ALWAYS still written
  (owner review + quality check need no toolchain).
- Revision loop: `POST /api/site-projects/:id/revisions` → `site.revise` job →
  `applyRevisionOverrides` (REVISABLE_FIELDS whitelist; free-text-only is
  rejected with guidance, never guessed). Applying a revision auto-expires
  pending/granted DEPLOY_PRODUCTION approvals (artifact changed).
- Deploy flow: `POST /api/site-projects/:id/request-deploy` (409 on failed
  quality check) → DEPLOY_PRODUCTION approval → decide route enqueues
  `deploy.production` → handler re-checks quality, `evaluateGate`, Vercel
  deploy (dry_run in local, always), DeploymentRecord + status live/failed.
  Preview deploys ride `operationalTicket` (made owner-triggered with
  credential pass-through in Phase E — advisory D4 resolved).
- Vercel adapter uploads directories recursively (skips dotfiles/symlinks/
  node_modules, errors on >200 files, vite projectSettings when package.json).
- Dashboard LeadDetail: revision form, request-deploy button, revisions +
  deployments lists. Compliance review 6/6 PASS (advisories D3/D5 applied).

### Done (Follow-up sequence — owner spec, 106 tests green)

- `workers/outreach/src/followup.ts`: hot leads get 2 follow-ups (~3.5d, then
  ~9d of silence), warm get 1, cold/skip get none. Polite bump + same audit
  finding + same mockup offer; passes `validateDraft` (opt-out line included).
- `outreach.followup` job (scheduled by each send via queue `delayMs`)
  re-screens EVERYTHING at fire time: DNC/unsubscribe first, then
  `evaluateFollowUp` (status still `contacted`, tier, real angle, valid email,
  no decisive reply — auto_reply doesn't count, ≤ `MAX_TOUCHES`=3 total).
  Idempotent (same-sequence draft dedupe) + send-time cap re-check. Each
  follow-up needs its own SEND_FIRST_TOUCH approval (shared gate — DECIDED in
  Phase E: stays shared; same risk class, per-draft approval).
- `outreach.close` job (+14d after every send): silence after the last touch →
  lead status `not_interested` (new LeadStatus). Negative replies also set
  `not_interested` — any no/unsubscribe/bounce stops forever.
- Priority (owner): warm replies > approved previews > strong new leads >
  follow-ups > weak leads — follow-ups are single delayed per-lead jobs and
  can never become the main job. Compliance delta review 7/7 PASS (advisory
  B1: "already built a mockup" copy claim is owner-specified, kept verbatim).

### Done (Phase E — experiments, weekly reports, ingestion, 132 tests green)

- Experiment engine (`workers/orchestrator/src/experiments.ts`): deterministic
  per-lead variant assignment (FNV-1a; `OutreachDraft.variant` IS the
  assignment record), results joined from sent drafts × replies (auto_reply
  excluded), upserted per experiment+variant+metric. handleDraft assigns from
  the running `outreach_variant` experiment; every draft still owner-approved.
- First-touch copy registry (`FIRST_TOUCH_VARIANTS` in draft.ts): v1 unchanged,
  new `v2-finding-first` (finding-led; same B1 mockup claim verbatim + opt-out
  line via shared constants; unknown variants fall back to v1, never throw).
- Experiments API (`POST /api/experiments` validates variants against the
  registry, `/:id/compute`, `/:id/conclude`) + dedicated dashboard page
  (create/recompute/conclude). Demo seeds one running copy experiment.
- Weekly reports: `WeeklyReport` schema/repo/whitelist (`weekly-reports`),
  `generateWeeklyReport` (7-day rollup, experiment findings, DurableLesson
  derivation: variant leader needs ≥10 sends/arm, failure category ≥5/week),
  Monday rollover in main.ts, `GET /api/reports/weekly`.
- Transcript ingestion: `POST /api/transcripts` → `ingest.transcript` job →
  `extractInsights` → lessons (new "design" topic; evidence
  `transcript:<source>`). Text is DATA — never executed (invariant 1).
- Preview deploys are owner-triggered only (advisory D4 resolved):
  auto-deploy removed from handlePreviewBuild; `POST /api/site-projects/:id/
  deploy-preview` → `deploy.preview` job; `operationalTicket` passes the
  vercel credential through (engine unchanged — local stays dry-run, tested).
- Compliance review 7/7 PASS. Advisory: when the transcript extractor becomes
  LLM-backed, it must return through compliance review (text enters a prompt).

### NEXT: Phase F (start here)

Everything left is credential-gated or LLM-gated: activate real adapters as
the 7 OwnerRequests get fulfilled (Stripe test mode + Vercel token first;
verify Instantly pauseLead + Vercel `framework:"vite"` assumptions with real
keys); LLM-assisted features behind an adapter (reply classification in
classify.ts, transcript insight extraction, free-text revision interpretation
— all strictly quoted-material-to-label, never instructions; compliance
review required); real lead sourcing (Google Places) when the key arrives;
staging rehearsal (`WILLIAM_ENV=staging` + sandbox creds + granted approvals).
