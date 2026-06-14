# William D'Amato — Project Standards

Agentic sales-and-delivery platform that wins website clients. Read
`docs/architecture.md` before structural changes.

**William is the business head (default `WILLIAM_BUILDS_WEBSITES=false`):** he
finds leads, runs outreach, handles replies/follow-ups, and on a positive reply
generates a **WebsiteBrief** (build prompt) for the *owner* to build on Fable 5 /
Opus 4.8 — then **ships** the owner's finished repo (`site.ship`) and drafts the
delivery email. William's own site-builder (preview/revise/deploy) is preserved
but silenced behind the flag; set it `true` to restore it. See the Phase F status
section below.

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

### Done (Phase F — business-head pivot, 158 tests green)

**Spec:** `docs/superpowers/specs/2026-06-13-william-business-head-design.md`.
**The pivot:** William is the *business head*. By default
(`WILLIAM_BUILDS_WEBSITES=false`) he no longer builds/deploys his own website
artifacts — on a positive reply he generates a **WebsiteBrief** (build prompt)
for the owner to run on Fable 5 / Opus 4.8, then **ships** the owner's finished
repo and drafts the delivery email. The self-builder is preserved behind the
flag, not deleted.

- **Off-switch** (`williamBuildsWebsites` in `RuntimeConfig`, env
  `WILLIAM_BUILDS_WEBSITES`, default `false`): the four builder handlers
  (`handlePreviewBuild`/`handleSiteRevise`/`handleDeployPreview`/
  `handleDeployProduction`) early-return with a `builder_disabled` activity note
  and never call `buildPreviewSite`/`applyRevisionOverrides`/`vercel.deploy`;
  they STAY in `JOB_HANDLERS` so stale jobs no-op. The three builder API routes
  return 403 `builder_disabled` (after the 404 check). `handleReply` enqueues
  `brief.generate` when off, `preview.build` when on.
- **`WebsiteBrief` entity** (`packages/core/src/schema/brief.ts` + `CompanyFacts`)
  → `store.websiteBriefs` repo → `website-briefs` collection whitelist →
  dashboard page. `targetModel` defaults `fable-5`, `status` `ready|shipped`.
- **Adapters** (`packages/integrations`): mock-first `firecrawl.scrapeCompany`
  (synthesizes `CompanyFacts` from audit hints; real on `FIRECRAWL_API_KEY`) and
  `llm.generateBuildPrompt` (deterministic template mock; real Opus 4.8 on
  `ANTHROPIC_API_KEY`). Both ride operational tickets, simulate on `ticket.dryRun`
  (zero network in local), and fall back to the template on failure. Shared
  `brief-prompt.ts` builds the prompt; the owner-required notes
  (**mobile-friendly + interactive + fully working on mobile**,
  **awwward-winning worthy**, and **generate visual/motion assets with
  Higgsfield**) are baked into every prompt (both the template and
  `BUILD_PROMPT_SYSTEM`). Wired into `detectCredentials` (`firecrawl`,
  `anthropic`) + `createIntegrations`.
- **`brief.generate` job** (`handleBriefGenerate`): audit weaknesses + scrape →
  LLM build-prompt → insert `WebsiteBrief(ready)` → owner notification.
- **`site.ship` job** (`handleSiteShip`): granted `DEPLOY_PRODUCTION` (subject =
  the brief) → Vercel prod deploy of the repo (dry-run; real repo/git-source
  deploy credential-gated) → `DeploymentRecord` (`websiteBriefId`,
  `siteProjectId` now nullable) → brief `shipped` → enqueue `outreach.delivery`.
- **Delivery email** (`createDeliveryDraft`, variant `delivery-1`): drafted by
  `handleDeliveryDraft`, re-screened for DNC, passes `validateDraft` (opt-out
  line + Cornell + mockup), `SEND_FIRST_TOUCH`-gated. On send, `handleSend`
  special-cases delivery: lead → `customer`, NO follow-up/close-out scheduled.
- **Dashboard:** new **Website Briefs** page (copy build prompt, "Mark website
  ready" + repo URL → opens the ship approval); Site Projects shows a "builder
  disabled" banner while the flag is off (`/api/overview` exposes the flag).
- **Outreach goes Opus** (`llm.generateOutreachCopy`): `handleDraft`/
  `handleFollowUp` build the template draft, then `applyOpusCopy` swaps in
  Opus-personalized copy when available. The opt-out line is GUARANTEED
  (appended deterministically if the model omits it); the Cornell + mockup (B1)
  claims and length caps are enforced by `validateDraft` with a **template
  fallback** on any miss, so a generation can never drop a required line. Mock
  returns `null` and the real adapter returns `null` under dry-run (local always
  templates, zero network) — the `variant`/experiment wiring and SEND_FIRST_TOUCH
  approval are preserved.
- **Compliance review 8/8 PASS** twice (pivot + outreach-Opus delta); pivot
  advisory A1 applied (all lead-derived strings fenced as untrusted data);
  remaining advisories are no-action/activation-time notes.
- **No new policy gates.** Ship reuses `DEPLOY_PRODUCTION`, delivery reuses
  `SEND_FIRST_TOUCH`. Mock-first: suite + `npm run demo` green with zero keys.

#### Re-enabling the self-builder

Set `WILLIAM_BUILDS_WEBSITES=true`: positive replies enqueue `preview.build`
again, the four builder handlers run, and the three builder API routes work.
Today's Phase A–D builder pipeline returns unchanged (kept under test by pinning
those builder tests to the flag).

### Done (LLM-assisted reply classification + transcript extraction — 180 tests green)

**Spec:** `docs/superpowers/specs/2026-06-14-llm-assisted-reply-classification-design.md`.
Two slices of NEXT STEP #4, both mock-first (local always dry-run → behavior
identical to before; no key needed).

- **Safety model (load-bearing):** the deterministic regex `classifyReply` stays
  AUTHORITATIVE. New `classifyReplyAssisted(text, assist?)` (`workers/outreach/
  src/classify.ts`) consults the LLM **only when the regex returns `unknown`** —
  any confident label (incl. the compliance-critical `unsubscribe`/`bounce`/
  `negative`) short-circuits first, so the model can NEVER override a stop signal.
  Upgrading an `unknown` to a stop signal is allowed (fail-closed-good). Injection
  detection is NOT delegated: `instructionAttemptDetected` comes only from the
  regex and the LLM can never clear it (ComplianceEvent path unchanged).
- **Adapter:** `llm.classifyReply(ticket, {text})` on `LlmAdapter` (mirrors
  `generateOutreachCopy`'s null-fallback). Mock → `null`; real (`real/llm.ts`)
  → `null` on `ticket.dryRun` (zero network locally), else Anthropic call with
  `CLASSIFY_SYSTEM` (reply fenced as untrusted DATA, invariant 1) → `parseIntentLabel`
  validates against the `ReplyIntent` zod enum; model `unknown`/non-enum/`!ok` →
  `null` (caller keeps the regex result). `LLM_ASSIST_CONFIDENCE=0.6` is
  informational only — never gates a decision.
- **Wiring:** `handleReply` mints `operationalTicket(ctx, "llm.classifyReply", …)`
  inside the assist closure (only for `unknown` replies; no gate/whitelist change).
  All downstream routing is unchanged.
- **Transcript extraction:** `llm.extractTranscriptInsights(ticket, {source,text})`
  on `LlmAdapter` (mock → `null`; real → `null` on dry-run, else Anthropic with
  `TRANSCRIPT_SYSTEM` fencing the transcript as untrusted DATA → `parseInsights`
  returns a validated `{topic,insight}[]`, fail-closed to `null` on bad/empty
  output). `handleTranscriptIngest` prefers the LLM result and falls back to the
  deterministic keyword extractor; `validTopics` is now derived from
  `DurableLesson.shape.topic.options` (can't drift). Insights still become
  DurableLessons (topic coerced, `transcript:<source>` evidence) — inert, never
  executed.
- **Compliance review PASS** on both deltas (advisories all INFO/no-action or the
  known activation-time re-review when the real path first runs in staging).

### Done (Firecrawl mergeScrape finalized — 185 tests green)

NEXT STEP #1's locally-buildable piece. The real `/v1/scrape` response shape was
confirmed against Firecrawl docs and `mergeScrape` (`real/firecrawl.ts`) finalized:
normalizes `metadata.title/description` (string OR array), sets `about` from the
description (→ audit floor → markdown slice), and FILLS missing `contact.email`/
`contact.phone` from the page markdown (audit-confirmed contacts are never
overridden; request now `onlyMainContent:false` so footer contact survives).
Result re-validated with `CompanyFacts.parse`; fail-closed to `synthesizeCompanyFacts`
on any HTTP error. Contact extractors scan a bounded slice with a length-capped
phone pattern (compliance advisory). Scraped text stays inert DATA fenced into the
build prompt (invariant 1). The TODO is resolved. **Compliance review PASS**
(1 LOW advisory applied; rest INFO). Real scraping still only runs in a non-local
env with `FIRECRAWL_API_KEY` (local always dry-run → synth).

### Done (.env auto-loading + Higgsfield build note — 187 tests green)

- **`.env` now loads automatically** at the runnable entry points. New
  `loadDotEnv(path=".env")` in `packages/core/src/env.ts` (Node's built-in
  `process.loadEnvFile`, no dependency) is called first in `workers/orchestrator/
  src/main.ts`, `apps/api/src/main.ts`, and `seed.ts`. NOT in `loadConfig` (tests
  stay hermetic) and deliberately NOT in `demo.ts` (the demo stays a hermetic
  dry-run). Put `.env` at the repo root; `loadConfig` still forces dry-run in
  local regardless of its contents (invariant 3 intact). Compliance PASS.
- **Build prompts now require Higgsfield** for visual/motion asset generation —
  one owner-required sentence added to both `templateBuildPrompt` and
  `BUILD_PROMPT_SYSTEM` (static instruction text; no untrusted-data path).

### NEXT STEPS (where to start next — all credential-gated, mock-first today)

Everything below is built mock-first and simulates until a key arrives; none of
it blocks. Rough priority:

1. **Activate the LLM + scrape adapters** (`ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`).
   They're wired (`createIntegrations` selects real on key presence) and the
   adapters are finalized (build-prompt/outreach/reply-classify/transcript on the
   LLM side; `mergeScrape` on the scrape side) — but **local is always dry-run →
   still templates/synth**. To exercise the real path you need a non-local env
   (`WILLIAM_ENV=staging`) + the key, then re-run `compliance-reviewer` on the
   live behavior (text→prompt) and confirm the real Firecrawl `about`/contact
   extraction against actual pages.
2. **Real repo/git-source Vercel deploy for `site.ship`** — today it dry-runs the
   repo URL through `vercel.deploy(sourcePath=repoUrl)`. Real shipping needs a
   Vercel token + git-source wiring (OwnerRequest exists). Verify Vercel
   `framework:"vite"` + Instantly `pauseLead` against real APIs at the same time.
3. **Stripe test mode** (`STRIPE_SECRET_KEY` test key) — validate the full
   payment-link/invoice + webhook flow end to end.
4. **Remaining LLM-backed features** behind the adapter: reply classification
   (`classify.ts`) and transcript insight extraction (`handleTranscriptIngest`)
   are **DONE** (see the section above) — only **free-text revision
   interpretation** is left, and it's dormant while the self-builder is off
   (`WILLIAM_BUILDS_WEBSITES=false`); do it when re-enabling the builder.
   Quoted-material-to-label, **compliance review required**.
5. **Real lead sourcing** (Google Places) when `GOOGLE_MAPS_API_KEY` arrives
   (also `ACTIVATE_NEW_LEAD_SOURCE`-gated).
6. **Staging rehearsal**: `WILLIAM_ENV=staging` + sandbox creds + granted
   approvals to watch one real (sandbox) lead flow through end to end.

Optional cosmetic: outreach advisory A1 (dedupe a fuzzy near-duplicate opt-out
line before appending in `applyOpusCopy`) — can't occur locally; low priority.

### Subagent-driven development (use it when it helps)

`.claude/agents/` defines domain subagents. Reach for them when a task is
focused on one domain or benefits from isolation/parallelism:
- **`compliance-reviewer` is MANDATORY** (read-only) for any change touching
  policy gates, outreach content, billing, deployment, webhooks/auth, DNC, or
  **anything that puts text into an LLM prompt** (invariant 1). Run it on the
  diff and apply its advisories before committing.
- **`outreach-operator`** for draft copy/variants/reply-handling;
  **`deployment-manager`** for the ship/Vercel path; **`billing-coordinator`**
  for Stripe; **`site-auditor`**/**`website-builder`** for audit/builder work;
  **`lead-researcher`** for sourcing; **`memory-manager`** for reports/lessons.
- Use a general/Explore agent for broad multi-file searches when you only need
  the conclusion. Keep the credential-activation steps above as small,
  single-domain changes — they're ideal candidates for the matching subagent
  plus a compliance pass, rather than one large edit.
