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

## ⚠️ ACTIVE PIVOT — collapsing to an OUTREACH-ONLY tool (read this first)

**As of 2026-06-28 we are refashioning this project into a focused
business-outreach tool. Everything below this banner describes the OLD
all-encompassing platform and is being trimmed away — do NOT resume building the
old version.** The pivot is owner-approved (design done; spec/plan next).

**New scope (the only job):** source local businesses from Google Maps → find a
real email (cheap discovery FIRST) → audit + score the site → if the site scores
above a threshold, write a short personalized email → push the lead + email to
**Instantly** for automated sending. That's it.

- **Branch:** all pivot work happens on **`outreach-tool`** (main stays the old
  version until we're done, then `outreach-tool` becomes the new main and the old
  version lives in git history). `.env` is untracked and rides along untouched —
  **never read `.env`.**
- **KEEP:** Google Places sourcing + business cap, the Playwright audit, the
  `scoreLead` scoring framework (+ visual scoring), email discovery/ranking, the
  SQLite store + queue, the API + a trimmed dashboard, and the safety rails
  (DNC/unsubscribe absolute, local = dry-run, side-effects need a ticket,
  inbound text is DATA).
- **SCRAP entirely:** follow-up/close-out automation, website building
  (templates, site-builder, briefs, ship/deploy), billing/Stripe,
  calendar/scheduling, **all inbound reply processing** (poller + classifier +
  opportunity/brief — the owner handles every reply in Instantly), experiments,
  weekly reports, the Vercel/Gmail adapters.
- **Pipeline reorder:** `source → contact (cheap email discovery: homepage GET +
  regex/rank + subpage crawl, NO browser/screenshots/Lighthouse) → [no email ⇒
  STOP, disqualify, no audit] → audit → score → [score ≤ threshold ⇒ STOP] →
  write email → review-or-push to Instantly`. **No audit runs until an email is
  found.**
- **Two easy-to-find settings** (top of config, env-overridable):
  `OUTREACH_SCORE_THRESHOLD = 45` (only email sites scoring ABOVE this; higher
  score = worse site = better prospect) and `PUSH_MODE: "review" | "auto" =
  "review"` (review = leads wait in the dashboard for Approve & push; auto =
  qualified leads push to Instantly automatically). Defaults chosen so the owner
  vets the first ~50 leads + the 45 cutoff + the emails, then flips to `auto`.
- **Sourcing modes:** *normal* = city + one niche + target N qualified (stops
  early); *batch* = city + multi-niche sweep + business cap (iterates the niche
  taxonomy, processes every business up to the cap, no early stop).
- **Email rules (William writes the WHOLE email; all rules in our code):**
  ≤5 sentences in the body (excluding greeting, P.S., sign-off), NO emdashes, no
  AI tells, friendly-professional **Cornell-student** voice, friendly **P.S.
  opt-out** (comma not emdash), no URL (site revealed only after they reply),
  keeps the free-mockup hook. Pushed to Instantly as `{{email_subject}}` /
  `{{email_body}}` custom variables.
- **Dashboard:** two clean pages — *Source Leads* (city/niche or batch-sweep +
  count/cap → runs list) and *Leads* (company, email, score, status; in review
  mode each ready lead shows its drafted email inline with Approve & push /
  Reject; in auto mode read-only monitoring). All other pages removed.
- **Build:** subagent-driven, TDD, mock-first, `compliance-reviewer` on the
  email-content + push changes; delete scrapped workers/packages in focused
  commits so the branch stays green.
- **Final step:** rewrite this file + `README.md` + `handoff.md` to describe the
  outreach-only tool (keep the invariants that still apply + the canary).

**Status: design + implementation plan approved 2026-06-28.** Spec:
`docs/superpowers/specs/2026-06-28-outreach-tool-pivot-design.md`. Plan:
`docs/superpowers/plans/2026-06-28-outreach-tool-pivot.md` (22 tasks,
subagent-driven, TDD, mock-first). **Execution order (resume here):**
Phase 0 baseline → Phase 1 delete scrapped handlers/workers/adapters/schemas/
routes/dashboard pages (keep suite green each commit) → Phase 2 add the two
settings → Phase 3 rewrite the email + Opus prompt (compliance-reviewer) →
Phase 4 reorder pipeline (cheap email discovery before audit) + score>45 gate +
PUSH_MODE auto-push (compliance-reviewer) → Phase 5 batch multi-niche sweep →
Phase 6 clean Leads page (inline email + Approve & push) → Phase 7 rewrite
CLAUDE.md/README/handoff + final verification. This banner is replaced by the
rewritten standards in Phase 7.

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

## ⚠️ Before going LIVE (production) — credential & safety checklist

**The current `.env` holds TEST / sandbox / placeholder credentials.** Every one
of these MUST be swapped to a real production value before flipping to live, or
the system will silently keep simulating (best case) or fail closed (worst case).
Work this list top-to-bottom when activating production:

- [ ] **Swap every credential from test → live.** In particular:
  - [ ] `STRIPE_SECRET_KEY` — replace the **test** key (`sk_test_…`) with the
        **live** key (`sk_live_…`).
  - [ ] `STRIPE_WEBHOOK_SECRET` — currently **blank**. Create a real webhook
        endpoint (Dashboard → Developers → Webhooks → `https://<domain>/webhooks/
        stripe`, subscribe `checkout.session.completed` + `invoice.paid`) and
        paste its signing secret (`whsec_…`). For *staging* testing, use the
        `stripe listen --forward-to localhost:4000/webhooks/stripe` secret
        instead. **Until a secret is set, payment-received confirmation is only
        accepted in local dry-run** (`apps/api/src/webhooks.ts`).
  - [ ] `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`, `GOOGLE_MAPS_API_KEY`,
        `VERCEL_TOKEN`/`VERCEL_TEAM_ID`, `INSTANTLY_API_KEY`/`INSTANTLY_CAMPAIGN_ID`,
        `GMAIL_*`, `GITHUB_TOKEN`, `ENRICHMENT_API_KEY`, `EMAIL_VERIFY_API_KEY`
        — confirm each is a real production value, not a placeholder/test key.
  - [ ] **`ANTHROPIC_MODEL` must NOT pin Opus.** The default is now Haiku
        (`claude-haiku-4-5-20251001`); a stray `ANTHROPIC_MODEL=claude-opus-4-8`
        left in `.env` from the activation session **OVERRIDES that default** and
        runs reply-classify + transcript extraction on Opus. **Unset it** (or set
        the Haiku id) unless Opus is intended. The per-task models
        (`ANTHROPIC_VISUAL_MODEL`, `ANTHROPIC_OUTREACH_MODEL`, `ANTHROPIC_BUILD_MODEL`)
        have their own defaults and are unaffected.
  - [ ] `OWNER_API_TOKEN` — a strong, unique random value (not a dev token).
- [ ] **`INSTANTLY_POLL_INTERVAL_MS` must be set (non-zero).** We do NOT pay for
      Instantly's webhook tier, so inbound replies arrive via the `/emails`
      poller, NOT a webhook. Set e.g. `300000` (5 min) and ensure the API key has
      the `emails:read` scope. **If this is `0`/unset, William never sees replies.**
      `INSTANTLY_WEBHOOK_SECRET` staying blank is fine (see the Instantly note).
- [ ] **`WILLIAM_ENV`**: rehearse at `staging` (sandbox creds) FIRST; only set
      `production` once a real lead has flowed end-to-end in staging. local is
      always dry-run by design (invariant 3) — it can never go live.
- [ ] **Grant the matching policy-gate approvals** in the dashboard (sends,
      payment requests, production deploys are all gated — granting a key does
      nothing without the approval).
- [ ] **Re-run `compliance-reviewer`** on the live text→prompt behavior once the
      real Anthropic/Firecrawl paths actually execute (activation-time re-review).
- [ ] **`npm test` green** and DNC/unsubscribe lists loaded before the first
      live send.

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
  `brief-prompt.ts` builds the prompt; the owner-required notes are baked into
  every prompt (both the template and `BUILD_PROMPT_SYSTEM`): **mobile-friendly +
  interactive + fully working on mobile**, **awwward-winning worthy**, **visual/
  motion assets via Higgsfield**, **GSAP + Three.js animation**, a **real working
  backend** (API routes + DB, server-side validation, persistence, owner
  notification — not a static mockup), **graceful loading states** (skeleton/
  placeholder base layers + spinners, no layout shift), **basic SEO** (semantic
  HTML, per-page title/meta description, OG/Twitter tags, alt text, sitemap/
  robots, JSON-LD `LocalBusiness`), and **Chrome DevTools quality verification**
  (Lighthouse, Performance panel, clean Console, mobile emulation). Wired into
  `detectCredentials` (`firecrawl`, `anthropic`) + `createIntegrations`.
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
- **Build prompts now require Higgsfield + a real backend + loading states +
  GSAP/Three.js + Chrome DevTools QA** — owner-required instruction lines added to
  both `templateBuildPrompt` (new `## Backend & functionality` and `## Before
  shipping — verify build quality with Chrome DevTools` sections) and
  `BUILD_PROMPT_SYSTEM` (static instruction text; no untrusted-data path,
  compliance PASS).

### Done (Instantly reply poller — free webhook alternative, 192 tests green)

**Spec:** `docs/superpowers/plans/2026-06-16-instantly-reply-poller.md`. Instantly
gates webhooks behind the $97/mo Hypergrowth tier; the v2 `GET /emails` API is on
every plan. So inbound replies can be **polled** instead of pushed — same
downstream pipeline, zero extra cost.

- **Adapter** (`instantly.pollInbound` on `InstantlyAdapter` + `InboundEmail`
  type): real adapter calls `GET /api/v2/emails?email_type=received&preview_only=false`
  (Bearer auth), normalizes `{externalMessageId, fromEmail, text}`, returns `[]`
  on `ticket.dryRun` (zero network in local) and **fail-closed `[]`** on any HTTP
  error (never crashes the loop). Mock returns `[]`. `TODO(activation)`: confirm
  live field names/pagination in staging (mirrors the `pauseLead` TODO).
- **`instantly.pollReplies` job** (`handlePollReplies`): ungated operational READ
  ticket → poll → resolve sender via `contacts.findByKey('email:…')` (unknown
  senders ignored, same as the webhook) → **dedupe against persisted
  `replyEvents.externalMessageId`** (serial FIFO queue guarantees the prior
  `reply.process` ran first) → enqueue the existing `reply.process`. Inbound text
  stays DATA → only ever feeds the fixed reply handler (invariant 1).
- **Scheduling**: `instantlyPollIntervalMs` (env `INSTANTLY_POLL_INTERVAL_MS`,
  default 0 = disabled) in `RuntimeConfig`; `main.ts` enqueues a poll job on that
  interval when > 0. Off by default → demo/tests unchanged.
- **Scope**: replies (and any bounce/unsub *text* that arrives as a received
  email, handled by the existing classifier). Instantly's *native* bounce
  (`i_status`) / unsubscribe-link events are not received emails and remain
  webhook-only — DNC/unsub screening at draft+send (invariant 4) is unaffected.
- **Compliance review 8/8 PASS**, no required fixes. Advisories INFO/LOW
  (activation-time re-review of the live `/emails` shape; optional backoff on
  repeated poll failures). No new policy gate.

### Done (Activation — credentials live + validated, 192 tests green)

**Activation session (2026-06-17).** Owner populated `.env` with real keys; each
was validated with a live read-only auth ping (no sends, no pipeline run). Tooling
installed: **Stripe CLI** (winget `Stripe.StripeCli`) + **Playwright Chromium**. A
**"⚠️ Before going LIVE" checklist** was added above the Status section. Still
`WILLIAM_ENV=local` → everything dry-run; **no staging rehearsal done yet.**

- **Validated live (authenticate):** `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`,
  `VERCEL_TOKEN`, `STRIPE_SECRET_KEY` (TEST key), `GOOGLE_MAPS_API_KEY` (Places API
  **v1** — legacy Places is off; use v1), `GMAIL_*` (`gmail.send` scope only; the
  adapter is send-only, Instantly is the primary channel).
- **Gmail:** initial refresh token failed (`invalid_grant`, minted against the
  wrong client); regenerated via OAuth Playground bound to the `.env` client → now
  valid. Account is Google **Workspace**, so the OAuth app was switched to **User
  Type = Internal** → the refresh token **no longer expires** (Testing-mode 7-day
  expiry was the original cause).
- **Instantly:** **Growth plan purchased** (~$47/mo monthly). Growth includes
  **API V2** — both `pushLead` (send) and `/emails` (poll); only *webhooks* are
  Hypergrowth-gated, and the poller already replaces those. A new **API V2 key** is
  in `INSTANTLY_API_KEY`, **`INSTANTLY_CAMPAIGN_ID` added**, and the `will@…`
  mailbox (warmed ~3 wk) activated in the campaign. Send cap 5,000/mo (≫ the
  ~600–1,500/mo a single mailbox at 20–50/day uses). **VERIFIED LIVE 2026-06-17:**
  auth ping returns **200** (was 402 pre-plan); `GET /campaigns` lists the live
  "Websites" campaign matching `INSTANTLY_CAMPAIGN_ID`; `emails:read` (poller scope)
  returns 200. Only `leads:create`/`leads:update` (write scopes) are unverified —
  exercised on the first real `pushLead` at staging.
- **Stripe webhook:** `STRIPE_WEBHOOK_SECRET` intentionally blank. For local/staging
  payment testing use the `stripe listen` signing secret; a real Dashboard endpoint
  secret is a go-live item.
- **Intentionally blank (none needed yet):** `GITHUB_TOKEN` (self-builder only —
  off), `VERCEL_TEAM_ID` (personal Hobby account — no team), `INSTANTLY_WEBHOOK_SECRET`
  (poller used), `ENRICHMENT_API_KEY`/`EMAIL_VERIFY_API_KEY` (only widen the funnel
  for leads without a published email).
- **Verified:** `npm run typecheck` clean, **192/192 tests**, `npm run demo`
  end-to-end, worker boots clean and reads `.env` (poller enabled at 300000 ms).
  Docs committed + pushed (`f9631d1` on `william-business-head`).

### Done (Visual scoring + email-only gate + per-task models, ~225 tests green)

**The change in one line:** outreach is now **email-only** (a lead with no real
email is `disqualified`, never contacted), email discovery is **staged + cost-
ordered**, the audit screenshots get a **Haiku vision score** that feeds the lead
score bidirectionally, and each Anthropic call now runs on a **per-task model**
(the global default flipped Opus → Haiku). All mock-first: local stays dry-run,
`npm run demo` + the suite pass with **zero keys**.

#### Email-finding logic (LOGGED at owner's explicit request)

- **Email-only outreach.** William contacts leads by email only. A lead with **no
  real email** (a phone number alone counts as no email) is set to status
  **`disqualified`** — the record is **KEPT** (not deleted), it is just never
  contacted. Reachability in scoring is now **email-only** (a phone no longer
  makes a lead reachable).
- **Staged, cost-ordered discovery in `handleContact`** — the browser fallback
  runs **only on a regex miss/placeholder**, never on every lead:
  1. **Cheap homepage pass** — `firstRealEmail(audit.extracted.contactEmails)`
     (placeholder-filtered, no network).
  2. **Playwright subpage crawl** (`crawlForEmail`) — only on a miss. Headless
     Chromium, `waitUntil:"networkidle"`, reads **both `innerText` and raw HTML**
     across likely subpaths (`/contact`, `/about`, `/team`, `/location`, `/book`,
     `/menu`, …), placeholder-blocklisted, **robots.txt-respected**, and
     **dry-run-safe** (returns empty under dry-run → local does no crawling).
  3. **Enrichment provider** (`ENRICHMENT_API_KEY`) on a continued miss.
  4. **None found → `disqualified` + an OwnerRequest** (blocked ≠ stuck,
     invariant 6).
- **Shared placeholder/extraction helpers in `@william/core`**:
  `isPlaceholderEmail`, `firstRealEmail`, `extractEmails`. `heuristics.extractSignals`
  now uses the shared `extractEmails` (one source of truth). New `Contact.emailSource`
  value **`"website_crawled"`** records a crawl-discovered address.
- **Pipeline reordered** to `lead.audit → lead.contact → lead.score →
  outreach.draft` — the email gate and the visual-scoring cost now sit **after**
  email resolution (no point scoring/visual-scoring a lead we can't email).

#### Visual scoring

- **`llm.scoreVisualDesign`** — a **Haiku vision** call that scores the audit
  screenshots; produces a new **`VisualAssessment`** schema stored on
  `WebsiteAudit.visualAssessment`. Runs in `handleScore` **only when screenshots
  exist** (playwright mode), on an **operational ticket**, mock-first (`null` in
  local/dry-run → behavior unchanged).
- **`scoreLead(audit, visual, config)`** combines the signals **bidirectionally**:
  a confident **`weak`** verdict **floors the score to warm** (promote a lead the
  heuristics under-rated); a confident **`strong`** verdict **caps it to skip**
  (demote a lead that already looks great). Reachability is **email-only**.

#### Per-task Anthropic models

- **`ANTHROPIC_MODEL` default flipped Opus → Haiku** (`claude-haiku-4-5-20251001`).
  It is the global fallback and drives **reply-classification** + **transcript
  extraction**.
- **`ANTHROPIC_VISUAL_MODEL`** (Haiku) — visual scoring;
  **`ANTHROPIC_OUTREACH_MODEL`** (Haiku) — outreach copy;
  **`ANTHROPIC_BUILD_MODEL`** (`claude-sonnet-4-6`) — build prompts.
  (This supersedes the earlier Phase F notes that said build prompts / outreach
  ran on Opus 4.8.)
- **⚠️ Activation caveat:** an explicit `ANTHROPIC_MODEL=claude-opus-4-8` left in
  `.env` from the activation session **OVERRIDES the new Haiku default** — unset
  it (or set the Haiku id) to actually run reply-classify/transcripts on Haiku.
  (Also in the "Before going LIVE" checklist and `docs/setup.md`.)

#### Outreach + build prompt

- **Outreach copy now references the real findings** — the visual assessment +
  Lighthouse results — fenced as **untrusted DATA** (invariant 1). The opt-out /
  Cornell / mockup (B1) claims and the `validateDraft` template-fallback guarantees
  are **unchanged**.
- **Build prompts condensed to ≤3 paragraphs** (generated by **Sonnet 4.6**),
  still requiring **every owner element** (Higgsfield, GSAP/Three.js, real backend,
  loading states, SEO, Chrome DevTools QA), now weaving in "make use of Framer,
  Figma, React, frontend-design", and ending with the literal line
  **`do not use superpowers`**.

#### Config + owner decision

- **`RuntimeConfig`** gained **`visualScoring`** (`weight` /
  `promoteMinConfidence` / `demoteMinConfidence`) and **`emailDiscovery`**
  (`subpaths` / `maxPages`). New env vars: `VISUAL_SCORING_WEIGHT`,
  `VISUAL_PROMOTE_MIN_CONFIDENCE`, `VISUAL_DEMOTE_MIN_CONFIDENCE`,
  `EMAIL_DISCOVERY_SUBPATHS`, `EMAIL_DISCOVERY_MAX_PAGES` (`.env.example` updated;
  documented in `docs/setup.md`).
- **OWNER DECISION:** robots-disallowed handling stays **OUT of `scoreLead`**
  (honoring the prior `bea732d "Remove crawl block"` commit); the orphaned robots
  scoring test was deleted. Robots is **still respected upstream** — the audit
  aborts and writes a compliance event — so honoring it is unchanged.

### Done (Staging rehearsal session — real-path fixes, 235 tests green)

**Where:** first run with `WILLIAM_ENV=staging` + `DRY_RUN=false` + `AUDITOR_MODE=playwright`
— the real paths executed for the first time (real Chromium audit, Sonnet/Haiku vision
call, email crawl). **All changes below are UNCOMMITTED on `main`; restart `npm run
worker` to load them.** Suite **235 green**, typecheck clean, `npm run demo` 0
dead-letter, dashboard builds, `compliance-reviewer` PASS on every sensitive delta
(credential wiring 8/8; outreach+audit; email gate 8/8).

- **Operational-ticket credential wiring (load-bearing).** Every operational
  read/generation ticket was minted WITHOUT a credential, so `computeDryRun` forced
  dry-run even on staging (`cred === "missing"`) and visual scoring / email crawl /
  scrape / outreach-copy / classify / build-prompt all silently simulated. New
  `credentialFor(ctx, integration)` + `localReadCredential(ctx)` in `context.ts`; ~11
  `operationalTicket(...)` sites in `pipelines.ts` now pass the matching credential
  (anthropic/firecrawl/instantly/enrichment/email_verify/calendar; the local email
  crawl uses an env-derived sandbox/live). Invariant 3 intact — local still forced
  dry-run, a missing credential still simulates. **This is what makes staging actually
  exercise the real paths.**
- **Crawl performance (per-lead time).** `crawlForEmail` was `networkidle` + 20s/page ×
  8 pages ≈ 160s on a site that never settles (a real coffee-shop site). Now `domcontentloaded`
  + per-page timeout + overall wall-clock budget, both config-driven:
  `emailDiscovery.pageTimeoutMs` (`EMAIL_DISCOVERY_PAGE_TIMEOUT_MS`, default 8000) and
  `budgetMs` (`EMAIL_DISCOVERY_BUDGET_MS`, default 25000); `maxPages` default 8→6.
- **Audit settle-before-capture.** The Playwright audit screenshotted immediately after
  `load`, so a late/lazy hero image was missed and fed a FALSE "no image" claim into the
  email. Now a bounded `networkidle` (8s cap) + 800ms settle runs BEFORE screenshot +
  content; `loadMs` is measured off the load event FIRST, so the "slow load" finding
  stays truthful.
- **Outreach plain-language.** `OUTREACH_SYSTEM` now bans web-design jargon (`hero`,
  `above the fold`, `CTA`, `viewport`, `LCP`, …) and requires plain words a
  non-technical owner understands. Opt-out / Cornell / mockup / length rules unchanged.
- **Score reachability fixed.** `scoreLead` gained a `{ reachableEmail? }` option;
  `handleScore` passes the RESOLVED contact's email presence, so a crawl/enrichment-found
  email no longer gets the −10 "no email" penalty (it was HTML-only before).
- **Email filter is DOMAIN-based.** `isPlaceholderEmail` keeps common prefixes on real
  domains (`info@<real-domain>`, `contact@`, `team@`) and rejects only fake/template
  DOMAINS (expanded `PLACEHOLDER_DOMAINS`: info.com, contact.com, test.com, sample.com,
  your-domain.com, mysite.com, website.com, company.com, business.com, …). `handleContact`
  now judges an enrichment email by `isPlaceholderEmail`, NOT by its source (removed a
  wrong "disqualify all enrichment in live" gate).
- **Dashboard.** Leads page gained an **Email** column — leads with a pending first-touch
  draft show the email inline with **Approve & send / Reject** (same gated
  `/approvals/:id/decide`). LeadDetail gained a **Contact** panel (email + source +
  verification + confidence) so the owner can judge a guessed address before approving.

⚠️ **Enrichment no longer guesses** (updated 2026-06-20): `createMockEnrichment` returns
`[]` and the rung is consulted only when a real provider is configured
(`ENRICHMENT_API_KEY`). A lead with no real email from homepage + crawl is disqualified,
not given a fabricated `info@<domain>`. Wiring a real enrichment provider + a real
deliverability verifier (today's "verify" only checks format) remains future work.

### Done (Automatic lead sourcing — 263 tests green, compliance PASS)

**Spec:** `docs/superpowers/specs/2026-06-21-lead-sourcing-design.md`. **Plan:**
`docs/superpowers/plans/2026-06-21-lead-sourcing.md`. Built subagent-driven, TDD,
mock-first — `npm test` 263 green, typecheck clean, `npm run demo` 0 dead-letter (sourcing
dormant in the demo: no `GOOGLE_MAPS_API_KEY` → local dry-run → mock Places, no run
enqueued). `compliance-reviewer` PASS on all targeted invariants.

William now sources qualified leads automatically instead of the owner hand-entering each.

- **Niche taxonomy + single source of truth.** Expanded `Niche` (5 → 38 + `other`) and a new
  `NICHE_META: Record<Niche, {label, searchTerm, outreachHook}>` in `@william/core`
  (`packages/core/src/niche.ts`) — `Record<Niche,…>` makes it exhaustive (a new niche won't
  compile without metadata). `NICHE_HOOKS` (draft.ts) now derives from `NICHE_META`
  (duplication removed); `nicheSearchQuery(niche, location)` builds the Places query.
- **Real Google Places (New `/v1`) adapter** (`packages/integrations/src/real/places.ts`):
  `POST /v1/places:searchText`, `X-Goog-Api-Key` + field mask that **deliberately omits phone**
  (owner collects no phone; cheaper SKU); maps each place → `DiscoveredBusiness {…, phone:null}`;
  returns `{ businesses, nextPageToken }` for pagination. `requireTicket` first (invariant 2),
  **empty + zero-network under `ticket.dryRun`** (invariant 3), **fail-closed empty** on any HTTP
  error. Selected by `GOOGLE_MAPS_API_KEY` presence; mock is the fallback (now paginated too).
- **`SourcingRun` entity** (`packages/core/src/schema/sourcing.ts`) → `store.sourcingRuns` repo →
  `sourcing-runs` collection whitelist → dashboard. Tracks `location/niche/target/candidateCap/
  status/candidatesIngested/qualifiedCount/leadIds/nextPageToken/checks/resultNote`.
- **Self-re-enqueuing `lead.source` controller** (`workers/orchestrator/src/sourcing.ts` +
  `handleLeadSource`): per tick — recompute qualified (`countQualified`: has an `OutreachDraft`
  AND latest `LeadScore.score > 35`), stop at target (`completed`) / candidate-cap
  (`stopped_cap`) / Places-exhausted (`stopped_exhausted`) / check-cap (`failed`); else, if the
  last page's leads are still pre-draft (`IN_FLIGHT_STATUSES` = `new/auditing/audited/scored/
  contact_ready` — `draft_ready`+ are RESOLVED for sourcing, since a draft = counted and won't
  auto-advance mid-run), wait+re-enqueue; else evaluate the gate and `ingestLead` up to the
  remaining cap (duplicate/DNC-blocked intakes don't count), re-enqueue. Doubly loop-bounded
  (`MAX_SOURCING_CHECKS` + no-op on non-`running`). Re-check delay + default cap (40) in
  `RuntimeConfig.leadSourcing` (`LEAD_SOURCING_RECHECK_MS`/`LEAD_SOURCING_CANDIDATE_CAP`).
- **API + gating + dashboard.** `POST /api/sourcing-runs {location,niche,target,candidateCap?}`
  creates a run (`pending_approval`) + an `ACTIVATE_NEW_LEAD_SOURCE` approval (reuses the existing
  `requestApproval` helper); `GET /api/sourcing-runs` lists. The decide route, **only on GRANT**,
  sets the run `running` and enqueues `lead.source`. New **Source-leads** dashboard page (form +
  runs list, niche dropdown from `NICHE_META`). `ACTIVATE_NEW_LEAD_SOURCE` is a pre-existing gate.
- **Cross-cutting core fix (so the dashboard can import `@william/core`):** the barrel was not
  browser-safe (Vite choked on `node:crypto`/`node:fs`). `newId` now uses
  `globalThis.crypto.getRandomValues` (same ULID format) and `loadDotEnv` wraps
  `process.loadEnvFile` in try/catch (no `node:fs`; missing `.env` = silent no-op, a present-but-
  unreadable `.env` logs a warning). Both behavior-preserving (full suite + demo green).
- **⚠️ Activation-time re-review owed (compliance advisory I2):** the real Places path has never
  executed (still local/dry-run). Before the first real sourcing run in staging, confirm the live
  `places:searchText` response shape (`nextPageToken` field name + that pagination terminates) and
  re-run `compliance-reviewer` on the live text→data path (sourced business strings stay DATA).

### Done (Approved send stranded — orphan-reclaim + HTTP timeout + send ok-check + idempotency + lead-detail approve, 286 tests green)

**Round 2 (same session): the send was ALSO hanging + silently false-succeeding.** After the
orphan-reclaim recovered the stuck job (attempts 1→2, proving reclaim works), it then hung in
`handleSend` → real `instantly.pushLead`: **`callJson` had NO HTTP timeout** (`real/shared.ts`),
so a non-responding request blocked the SINGLE serial worker forever (the next approved send sat
`pending` behind it; lead never `contacted`). Compounding bug: **`handleSend` never checked
`result.ok`** — a *failed* push would still mark the lead `contacted` + record a campaign sync
(silent false success). Fixes (TDD): (a) `callJson` now applies `AbortSignal.timeout` (default 20s,
honors a caller signal) → a hung request returns the normal `{ok:false}` failure instead of
freezing the queue; Anthropic calls get 60s via an `anthropicCall` helper (they can run long; still
fail-closed to template). (b) `handleSend` throws on `!result.ok` (writes a `send_failed` activity)
→ the job retries then dead-letters, lead stays pre-send, NO false `contacted`/sync. **286 tests**
(2 more: callJson-abort, failed-push-not-contacted), typecheck clean, demo 0 dead-letter,
`compliance-reviewer` **8/8 PASS** (A1 LOW advisory — the 60s Anthropic timeout — applied). **Net:
a hung Instantly call can no longer freeze the worker, and a failed send is now VISIBLE (dead-letter
+ activity) instead of a fake "contacted". ⚠️ The first real `pushLead` (write scope) had never run
live — restart the worker to load this; the hang now surfaces as a readable error in the job's
`last_error` so the real Instantly issue can be diagnosed.**

### Done (Approved send stranded — queue orphan-reclaim + send idempotency + lead-detail approve, 284 tests green)

**Owner-reported, 2026-06-22; UNCOMMITTED on `main`.** Symptom: owner approved a first-touch email
but it never pushed to Instantly and the lead never went to `contacted`. **The approve→send wiring
is CORRECT** — the decide route enqueues `outreach.send` (`server.ts:184`) and `handleSend` pushes
to Instantly then flips the lead to `contacted` (`pipelines.ts:600`). Two compounding causes,
confirmed by querying `data/william.db` (a `running` `outreach.send` job + an overdue unclaimed
`instantly.pollReplies`) and the process list (API+dashboard up, **no `npm run worker`**):

1. **The worker wasn't running.** In `staging`/`production`, `kickQueue` is a **no-op** — it only
   drains inline when `env === "local"` (`server.ts:67-70`). So `outreach.send` is processed ONLY
   by the separate `npm run worker`. With no worker, the enqueued send sits forever.
2. **Durability bug (real):** a worker had claimed the send (status→`running`), then stopped
   mid-job. `JobQueue.claimNext` only selects `status='pending'` (`queue.ts:64`), so an orphaned
   `running` job is **stranded forever** — silently losing an approved lead on every worker
   restart/crash.

Fixes (TDD, mock-first):
- **`JobQueue.reclaimRunning()`** (`packages/db/src/queue.ts`): resets orphaned `running`→`pending`
  (preserving `attempts`), and **dead-letters** any job already at `max_attempts` (poison-loop
  guard). Called once at `runForever` startup (`runner.ts`) with a warning log — **a worker restart
  now auto-recovers the stuck send.** Single-process model makes "all running = orphan at startup"
  safe. (Local inline path unchanged — dry-run/demo.)
- **Idempotency guard in `handleSend`** (`pipelines.ts`): a re-run for an already-`sent`/
  `sent_dry_run` draft is a no-op (writes a `send_skipped_duplicate` activity) → reclaim can never
  double-push. This was the `compliance-reviewer` LOW advisory (first-touch/delivery drafts weren't
  covered by the followup-only touch cap), applied. Each touch is its own draft, so follow-ups are
  unaffected.
- **LeadDetail "Approve & send / Reject" button** next to the email (`apps/dashboard/src/pages/
  LeadDetail.tsx`): fetches the lead's pending approval from the existing `GET /api/review-queue`
  and posts to the existing gated `POST /api/approvals/:id/decide` (same SEND_FIRST_TOUCH gate +
  send screening as the Review Queue / Leads page — no new endpoint, no new gate). The
  pending-approval draft auto-expands so the email sits next to the buttons.
- **284 tests green** (3 new: 2 queue reclaim, 1 send idempotency), typecheck clean, demo 0
  dead-letter, dashboard builds. **`compliance-reviewer` PASS** (8/8 invariants; the duplicate-send
  advisory it raised was applied — gate/DNC/touch-cap re-checks all still run on every reclaimed
  send). **Operational: staging needs `npm run worker` + `npm run dev:api` + `npm run dev:dashboard`
  all running; restarting the worker auto-recovers the currently-stranded send.**

### Done (Mobile audit-screenshot fidelity — real device emulation, committed `51519a0`, 281 tests green)

**Owner-reported, 2026-06-22; UNCOMMITTED on `main`.** Trigger: the dashboard's mobile audit
preview didn't match what the owner saw opening the site on a real phone. **Diagnosis: a backend
bug costing leads, not a display issue.** The dashboard renders the PNG faithfully
(`LeadDetail.tsx` plain `<img maxWidth:100%>`); the *screenshot itself* was a bad mobile render.
Root cause (`workers/site-auditor/src/playwright-audit.ts`): the "mobile" shot loaded the page at
DESKTOP viewport, then `page.setViewportSize(390×844)` and screenshotted — a width-only resize
that **never enables Chromium's `isMobile`**, so `<meta name="viewport">` is ignored and the page
renders as a *narrow desktop window*, not a phone (also no retina `deviceScaleFactor`, no mobile
`userAgent`, no re-settle after resize). That mobile PNG is sent (with desktop) into
`llm.scoreVisualDesign` → `VisualAssessment` feeds `scoreLead` **bidirectionally** (weak floors to
warm, strong caps to skip) AND is referenced as an outreach "finding" → mis-scored leads + a
possible false "your site doesn't work on mobile" claim. (`mobileFriendly` is from
`signals.hasViewportMeta`, NOT the screenshot — unaffected.)

- **Fix:** the mobile shot is taken on a **dedicated device-emulated page** (`MOBILE_EMULATION`:
  `viewport 390×844`, `isMobile:true`, `hasTouch:true`, `deviceScaleFactor:3`, iPhone `userAgent`)
  that **navigates fresh** to the same already-robots-cleared URL, with the same bounded
  `networkidle`(8s)+800ms `settle()` the desktop shot uses (extracted to a shared helper). The
  desktop page now stays at desktop viewport through axe/Lighthouse (previously it ran them at the
  resized mobile viewport). Same fix applied to `qualityCheckPreview` (the disabled self-builder's
  preview check). `browser.ts` gained a `NewPageOptions` type carrying the emulation fields
  (Playwright's `browser.newPage` applies them at the implicit context; Chromium-only — the browser
  we launch). `setViewportSize` stays in `MinimalPage` (still used by `email-crawl.ts`).
- **TDD** (failing test first: asserts a dedicated `isMobile:true` mobile-width page navigates
  fresh and `setViewportSize` is never called for the capture). **281 tests green**, typecheck
  clean, demo 0 dead-letter. **`compliance-reviewer` 8/8 PASS** (no required fixes; INFO advisory:
  on the first real staging playwright audit, confirm the mobile PNG visibly differs from the
  desktop PNG — folds into the already-mandated activation-time image→prompt re-review).
- **Restart `npm run worker` + `npm run dev:api` to load it.** Real effect only shows in
  `AUDITOR_MODE=playwright` (staging); local/mock/http never capture screenshots, so dry-run
  behavior is unchanged.

### Done (Email ranking + telemetry suffix-blacklist + reject→draft, 280 tests green)

**Owner-reported, 2026-06-22; committed + pushed `fab3695`.** Trigger: easlandscaping.com got
an email that wasn't even on the site while real service contacts were missed. Three fixes,
TDD + mock-first (280 tests green, typecheck clean, demo 0 dead-letter on a clean db,
`compliance-reviewer` PASS).

- **Ranked email picker** (`bestBusinessEmail` + `isTopTierContact` in `packages/core/src/email.ts`)
  replaces "first non-placeholder wins". Tiers: role@own-domain > any@own-domain >
  company-named@free-provider > role@other > other; no-reply/system demoted; placeholders excluded;
  lenient fallback to best-available (company-named match is full-token OR short prefix abbreviation
  — `eas@` for "EAS Landscaping" — never an arbitrary substring). Wired into `handleContact` (homepage
  pass still crawls when its hit isn't a role@own-domain, so junk can't shadow a real `/contact`
  address) and `crawlForEmail` (now ranks across ALL pages, not first-match-per-page). Systematic
  cause: nothing ranked — first email in source order won, and the crawl scanned raw HTML so
  hidden/3rd-party addresses leaked.
- **Suffix-matching blacklist** — `isPlaceholderEmail` exact-matches `PLACEHOLDER_DOMAINS` AND
  suffix-matches a new `PLACEHOLDER_DOMAIN_SUFFIXES` set (`wixpress.com`, `sentry.io`) → kills
  `sentry.wixpress.com` and any `*.wixpress.com`/`*.sentry.io` (no more whack-a-mole). The split keeps
  the suite's `*.example.com` fixtures (exact-only) resolving as real.
- **Reject → draft status** — the decide route sets the `OutreachDraft` to `"rejected"` when a
  `SEND_FIRST_TOUCH` draft is rejected (was staying `pending_approval`); lead status untouched.

### NEXT STEPS

**Where we are (2026-06-22):** the platform is feature-complete and built mock-first end to end.
Automatic lead sourcing (Google Places) and the email-ranking / suffix-blacklist / reject→draft
fixes are **DONE, committed + pushed** on `main` (latest `fab3695`); the mobile audit-screenshot
fidelity fix is committed (`51519a0`); the queue orphan-reclaim + send-idempotency + lead-detail
approve-button + send HTTP-timeout/ok-check fixes are **DONE but UNCOMMITTED** on `main`. `npm test` **286 green**, typecheck clean,
`npm run demo` 0 dead-letter (on a clean db), `compliance-reviewer` PASS on every sensitive delta.
**First real outbound has happened** (two leads queued to the live Instantly
campaign, weekdays-only). **Restart `npm run worker` + `npm run dev:api` to load the latest code.**
The remaining work is (1) a few real builds, (2) proving live paths that have only run on mocks,
(3) the go-live checklist.

**WORKING (mock-first, zero credentials):** the full pipeline — intake / **source (Google Places)**
→ audit → **email gate + ranked discovery** → score (+ visual when screenshots exist) → draft →
owner approval → (simulated) send → reply classify → opportunity → WebsiteBrief → ship (simulated
prod deploy) → delivery draft → billing draft → (simulated) payment link → daily/weekly reports.
DNC/unsubscribe screened at intake/draft/send; gates + compliance suite green.

**NEXT to BUILD (new code), priority order:**
1. **Deeper email discovery (recommended)** — mailto/JSON-LD priority + Cloudflare
   email-obfuscation decode for JS-rendered sites where the real address isn't in static text.
   Compounds the new ranking; biggest sourcing-hit-rate lever (the standing "still owed" item).
2. **Real enrichment + deliverability verifier** — enrichment returns `[]` today (no guessing) and
   "verify" only checks format; wire `ENRICHMENT_API_KEY`/`EMAIL_VERIFY_API_KEY` to unblock no-email
   leads + confirm deliverability. Compliance review required.
3. **Real Vercel git-source deploy for `site.ship`** — currently dry-runs the repo URL; needs
   git-source wiring (OwnerRequest exists). Verify Vercel `framework:"vite"` + Instantly `pauseLead`.
4. **Sourcing autopilot top-up** — auto-maintain N qualified leads on the `lead.source` controller
   (spec lists it as future). Optional.
5. **Free-text revision interpretation** — dormant while `WILLIAM_BUILDS_WEBSITES=false`; build when
   re-enabling the self-builder. Compliance review required.
6. **Per-niche response-rate tracking → niche-aware sourcing (owner idea, 2026-06-22 — NOT YET
   SPECCED).** Owner's stated intent: track which **niches** get the highest outreach response
   rate so that, once live with **automatic lead sourcing** (`lead.source` controller), William
   preferentially targets the best-performing niches instead of treating all niches equally. The
   building blocks already exist — `Reply`/`classifyReply` (reply outcomes), `OutreachDraft`/send
   records (the denominator), `NICHE_META`/`Niche` (the dimension, on every lead + `SourcingRun`),
   the **experiment engine** + `WeeklyReport` rollups (precedent for sent×replied aggregation +
   `DurableLesson` thresholds), and the sourcing autopilot top-up (item #4) as the natural consumer
   of a niche ranking. ⚠️ **Do NOT just build this — the owner explicitly asked to be questioned
   first.** Before any code, run a **brainstorm pass** (`superpowers:brainstorming`) and confirm
   with the owner: *why* / the real goal; **which metric counts as "response"** (any reply vs.
   positive/interested reply vs. booked call vs. paid customer — `auto_reply` excluded, per the
   experiment-engine precedent); the **minimum sample size** before a niche's rate is trusted (cf.
   the weekly-report ≥10-sends/arm rule) and how **cold-start / zero-data niches** are handled (so a
   new niche isn't starved); **how aggressively** to weight (hard prioritization vs. soft tilt with
   exploration so we keep sampling); **time-windowing / decay** (all-time vs. trailing N weeks);
   and whether the owner can **manually pin/exclude** niches. Then spec → plan → TDD → mock-first.
   `compliance-reviewer` if any reply text reaches an LLM prompt (it should stay DATA — niche +
   counts only).

**LEFT UNDONE (built, never proven on real paths):**
- **Inbound loop** — a real reply → Instantly poller → classifier → opportunity → brief → ship →
  delivery has never run live. Watch the Monday sends.
- **First real Google Places run** — confirm the live `searchText` shape + pagination, then the
  **mandatory `compliance-reviewer` re-review on the live text→/image→prompt behavior** (advisory I2)
  before the first live send.
- **Stripe test-mode end-to-end** — payment link/invoice + webhook via the `stripe listen` secret.

**NEEDS FIXING / gotchas:**
- **Restart worker/API after any code change** — running processes hold old code.
- **`npm run demo` + a running worker:** the worker locks `./data/william.db`, so the demo can't reset
  it and silently reuses a stale db ("0 created" → "already granted"). Stop the worker or run
  `DATA_DIR=./data-demo-clean npm run demo`. Not a code bug.
- **Stray `ANTHROPIC_MODEL=claude-opus-4-8` in `.env`** overrides the Haiku default for
  reply-classify/transcripts — unset unless Opus is intended.
- **Outreach advisory A1** — dedupe a fuzzy near-duplicate opt-out line in `applyOpusCopy`; low
  priority, can't occur locally.

**Before production:** work the **"⚠️ Before going LIVE" checklist** above the Status section.

The detailed staging→activation sequence and dated history follow below.

**✅ DONE (owner-reported, 2026-06-21) — placeholder blacklist + Lighthouse-gated slow claim
+ no-URL outreach.** Committed + pushed (`726d32d`, blacklist add `35bee7d`); 242 tests
green, typecheck clean, demo 0 dead-letter; `compliance-reviewer` 8/8 PASS.
  - **Placeholder-domain blacklist expanded** (`packages/core/src/email.ts`): a real lead's
    Shopify-template `…@mystore.com` was approved as a contact (it shadowed the real address
    because `mystore.com` wasn't blacklisted and `firstRealEmail` returns the first
    non-placeholder). Added `mystore.com` + a curated set of theme/CMS/store-builder demo
    domains; real providers/custom domains deliberately excluded. **Still owed:** deeper
    email discovery (mailto/JSON-LD priority + Cloudflare-obfuscation decode) for
    JS-rendered sites where the real address isn't in the static text.
  - **Slow-load claim is Lighthouse-gated:** the raw `load`-event time overstated perceived
    speed, so fast sites were called slow in outreach. `deriveFindings` no longer emits a
    `loadMs`-based outreach claim (internal weakness only, >6s); new `lighthouseSlowAngle`
    adds the plain-language slow angle **only when Lighthouse confirms** (perf < 50), wired
    into `handleScore` after the deferred Lighthouse run.
  - **No URL in pre-reply outreach:** stripped `williamdamato.com` + the prospect-domain
    parenthetical from first-touch/follow-up templates; `OUTREACH_SYSTEM` forbids links and
    no longer receives the prospect URL; `validateDraft` rejects a URL in any non-delivery
    draft (the delivery email still carries the live link — the site is revealed only after
    the prospect engages). **Outreach content changed → `compliance-reviewer` owed before
    the next send.**

**✅ DONE (owner-specified, 2026-06-20) — dropped the `info@<domain>` guess; don't analyze
un-emailable leads.** Committed + pushed (`726d32d`); 236→242 tests green, typecheck clean, demo 0
dead-letter. Two linked changes:
  - **No more `info@<domain>` guessing.** `createMockEnrichment.findContacts` no longer
    fabricates `info@<domain>` (returns `[]`), and `handleContact` consults the enrichment
    rung **only when a real provider is configured** (`credentialFor(ctx, "enrichment")`).
    A lead with no REAL email from the **homepage pass + Playwright crawl** is **not
    contactable → disqualified** (record KEPT) and raises the enrichment-provider
    OwnerRequest (invariant 6). A configured provider's found contact is still validated by
    domain (`isPlaceholderEmail`) + the verify step. This supersedes the "keep
    `info@<real-domain>` enrichment guess" behavior from the staging-rehearsal session.
  - **Lighthouse deferred → only runs for emailable leads.** The Playwright audit now
    **skips Lighthouse** (new `skipLighthouse` on `auditWebsite`/`playwrightAudit`); it
    runs in `handleScore` via the new `runDeferredLighthouse` (own short-lived Chromium),
    which only executes after `handleContact` resolves an email. So an un-emailable lead
    incurs **neither** Lighthouse **nor** the visual review (`llm.scoreVisualDesign` was
    already gated by pipeline order — `lead.score` is enqueued only after a contact is
    found). Playwright mode only; mock synthesizes scores and http never had them, both
    decided at audit time as before. `scoreLead` consumes the merged `audit.lighthouse`.
  - **Still owed:** `compliance-reviewer` on the live text→/image→prompt behavior before
    the first outbound send (the change is conservative — fewer addresses, never guessed —
    but the review is still mandatory at activation).

The remaining staging → activation sequence:

1. **STAGING REHEARSAL — `WILLIAM_ENV=staging` is now SET and the real paths are live**
   (local can never go live — invariant 3). Continue in this order:
   - **(a) Local sanity first, zero side effects:** `npm run typecheck`, `npm test`
     (expect **236 green**), `npm run demo`, and boot `npm run worker` to confirm it
     reads the updated `.env` cleanly. Still dry-run — this just proves the `.env`
     edits broke nothing.
   - **(b) Staging, SAFE read/generation paths FIRST** (no outbound, no payment): set
     `WILLIAM_ENV=staging` **and `AUDITOR_MODE=playwright`** (REQUIRED — the visual
     score only runs when real screenshots exist; run `npx playwright install chromium`
     if missing). Grant the matching **policy-gate approvals** in the dashboard (a key
     alone does nothing). Then on a real lead with a website, confirm the NEW paths:
     the Chromium audit produces screenshots → **`llm.scoreVisualDesign`** returns a
     sane `VisualAssessment` and the promote/demote shifts the tier sensibly;
     **`crawlForEmail`** finds a real email on a subpage (and the gate disqualifies a
     genuinely email-less lead), respecting robots.txt. Alongside: the existing safe
     reads — Firecrawl `about`/contact extraction on real pages, Anthropic
     build-prompt + reply-classification, the live `/emails` poller shape
     (`TODO(activation)` in `instantly.ts`). (Instantly API already verified live
     2026-06-17 — key 200, campaign + `emails:read` confirmed.)
   - **(c) Only then** enable the gated side-effects (Instantly sends, Stripe, prod
     deploys).
2. **Re-run `compliance-reviewer` on the live text→prompt AND image→prompt behavior**
   once the real Anthropic/Firecrawl/**vision**/crawl paths execute — this now also
   covers the screenshots-as-untrusted-DATA vision call (`VISUAL_SCORE_SYSTEM`) and
   live crawled page content. **MANDATORY before the first live send.**
3. **Real repo/git-source Vercel deploy for `site.ship`** — today it dry-runs the
   repo URL through `vercel.deploy(sourcePath=repoUrl)`. Real shipping needs the
   Vercel token (have it) + git-source wiring (OwnerRequest exists). Verify Vercel
   `framework:"vite"` + Instantly `pauseLead` against real APIs at the same time.
4. **Stripe full flow** — validate payment-link/invoice + the webhook (via the
   `stripe listen` secret) end to end in test mode; set a real endpoint secret for
   production.
5. **Optional / later:** enrichment + email-verify providers
   (`ENRICHMENT_API_KEY`/`EMAIL_VERIFY_API_KEY`) to unblock leads without a published
   email; **free-text revision interpretation** (dormant while the self-builder is
   off, `WILLIAM_BUILDS_WEBSITES=false`; **compliance review required** when added).
6. **Production**: only after a real lead flows end-to-end at staging — work the
   **"⚠️ Before going LIVE" checklist** (above the Status section): test→live key
   swaps (esp. Stripe `sk_live_`), strong `OWNER_API_TOKEN`, gate approvals,
   `npm test` green + DNC lists loaded.

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
