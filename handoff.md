# Handoff — William D'Amato Agent

> **Read this first, then `CLAUDE.md`** (project standards, the 6 invariants, the
> full phase history, and the detailed NEXT STEPS). `CLAUDE.md` is authoritative;
> this file is the quick orientation.
>
> **Canary:** address the owner as **Powell** at the start of every response. If a
> reply doesn't start with "Powell", context was lost — re-read `CLAUDE.md`.

**Last updated:** 2026-06-20 — **staging rehearsal has STARTED.** `WILLIAM_ENV=staging`,
`DRY_RUN=false`, `AUDITOR_MODE=playwright` are set and the real paths executed for the
first time (real Chromium audit + screenshots, Sonnet/Haiku vision score, email crawl).
A batch of real-path fixes landed this session (see "Staging rehearsal session" below
and the matching section in `CLAUDE.md`). **All of it is UNCOMMITTED on `main`** — 235
tests green, typecheck clean, `npm run demo` 0 dead-letter, dashboard builds,
`compliance-reviewer` PASS on every sensitive delta. Commit/push awaits owner sign-off;
the running `npm run worker` must be **restarted** to load the changes.

### ▶ START HERE (next chat): continue the staging rehearsal

The previous IMMEDIATE step — **drop the `info@<domain>` guess + don't analyze
un-emailable leads** — is **DONE** (2026-06-20, uncommitted on `main`, 236 tests green,
typecheck clean, demo 0 dead-letter). See "No-guess email gate + deferred Lighthouse"
below. Next up:

- **Re-run `compliance-reviewer`** on the live text→/image→prompt behavior (mandatory
  before the first live send — covers screenshots-as-untrusted-DATA vision call + live
  crawled page content). This change is conservative (we now contact FEWER addresses,
  never a guessed one) but a review pass is still owed before going outbound.
- Continue the staging rehearsal to the gated side-effects, then the "⚠️ Before going
  LIVE" checklist.

### Email blacklist + Lighthouse-gated slow claim + no-URL outreach — 2026-06-21 (uncommitted on `main`)

Owner-reported fixes (mock-first, 242 tests green, typecheck clean, demo 0 dead-letter):

1. **Placeholder-domain blacklist expanded** (`packages/core/src/email.ts`). A real lead's
   Shopify-template `…@mystore.com` was being approved as a contact because `mystore.com`
   wasn't blacklisted, and `firstRealEmail` returns the first non-placeholder — so the fake
   shadowed the real address. Added `mystore.com` + a curated set of theme/CMS/store-builder
   demo domains (`yourstore.com`, `yourcompany.com`, `companyname.com`, `demo.com`,
   `acme.com`, `mailinator.com`, …). Real providers/custom domains are deliberately NOT
   listed. **Deeper email-discovery work still owed** (the real address on a JS-rendered or
   Cloudflare-obfuscated site is still missed — mailto/JSON-LD priority + Cloudflare decode
   is a good follow-up).
2. **Slow-load claim is now Lighthouse-gated** (your 3+4). The raw `load`-event time
   overstates perceived speed (waits on every pixel/lazy image/widget), so fast sites were
   called slow in outreach. `deriveFindings` no longer turns `loadMs` into an outreach claim
   (kept only as an internal weakness at >6s); the new `lighthouseSlowAngle(lighthouse)`
   adds the plain-language "slow to load" angle **only when Lighthouse confirms** (perf < 50),
   wired into `handleScore` right after the deferred Lighthouse runs.
3. **No URL in pre-reply outreach.** Stripped `williamdamato.com` + the prospect-domain
   parenthetical from first-touch + follow-up templates; `OUTREACH_SYSTEM` now forbids any
   link and we no longer feed the prospect's URL into the prompt; `validateDraft` rejects a
   URL in any non-delivery draft (delivery email still carries the live link). The website is
   revealed only after the prospect engages (delivery email).

⚠️ **Outreach content changed → `compliance-reviewer` is owed** before the next outbound
send (it's a mandatory-review trigger: outreach copy + `validateDraft`).

### No-guess email gate + deferred Lighthouse — 2026-06-20 (uncommitted on `main`)

Owner-specified. Two linked changes (mock-first, 236 tests green):

1. **No more `info@<domain>` guessing.** `createMockEnrichment.findContacts` no longer
   fabricates `info@<domain>` (returns `[]`), and `handleContact` now consults the
   enrichment rung **only when a real provider is configured** (`credentialFor(ctx,
   "enrichment")`). A lead with no real email from the **homepage pass + Playwright
   crawl** is **disqualified** (record KEPT) and raises the enrichment-provider
   OwnerRequest. A configured provider's found contact is still validated by domain
   (`isPlaceholderEmail`) + the verify step.
2. **Lighthouse deferred → only runs for emailable leads.** The Playwright audit now
   **skips Lighthouse** (`skipLighthouse` on `auditWebsite`/`playwrightAudit`); it runs
   in `handleScore` via the new `runDeferredLighthouse` (own short-lived Chromium) —
   which only executes after `handleContact` resolves an email. So an un-emailable lead
   incurs **neither** Lighthouse **nor** the visual review (the visual review was
   already gated by pipeline order: `lead.score` is enqueued only after a contact is
   found). Playwright mode only; mock/http decide their lighthouse at audit time as
   before.

For the original full detail in `CLAUDE.md` → "NEXT STEPS" → IMMEDIATE NEXT STEP.

After that: re-run `compliance-reviewer` on the live text→/image→prompt behavior
(mandatory before the first live send), continue the staging rehearsal to gated
side-effects, then the "⚠️ Before going LIVE" checklist.

### Staging rehearsal session — 2026-06-20 (real-path fixes, UNCOMMITTED on `main`)

First run with the real paths live. **Restart `npm run worker` to load these.**

- **Operational-ticket credential wiring (load-bearing).** Operational read/generation
  tickets were minted WITHOUT a credential → `computeDryRun` forced dry-run even on
  staging, so visual scoring / email crawl / scrape / outreach-copy / classify /
  build-prompt all silently simulated. New `credentialFor` + `localReadCredential`
  (`context.ts`); ~11 `operationalTicket(...)` sites in `pipelines.ts` now pass the
  matching credential. Invariant 3 intact. **This is what makes staging exercise the
  real paths.**
- **Crawl perf:** `crawlForEmail` was `networkidle` + 20s/page × 8 ≈ 160s on a site that
  never settles. Now `domcontentloaded` + per-page timeout + overall budget (config:
  `EMAIL_DISCOVERY_PAGE_TIMEOUT_MS`=8000, `EMAIL_DISCOVERY_BUDGET_MS`=25000), maxPages 8→6.
- **Audit settle:** bounded `networkidle` (8s) + 800ms settle BEFORE screenshot/content
  so late/lazy hero images are captured (fixed a false "no image" claim); `loadMs`
  measured off the load event first, so the "slow load" claim stays truthful.
- **Outreach plain-language:** `OUTREACH_SYSTEM` bans web-design jargon (hero/CTA/etc.).
- **Score reachability:** `scoreLead({reachableEmail})` from the resolved contact — no
  wrongful −10 when the crawl/enrichment found the email.
- **Email filter is DOMAIN-based:** keeps `info@`/`contact@`/`team@` on real domains,
  rejects fake DOMAINS (expanded `PLACEHOLDER_DOMAINS`). `handleContact` judges enrichment
  emails by domain, not source. **(This is what the IMMEDIATE step partly reverses — no
  guessing at all.)**
- **Dashboard:** Leads page **Email** column (inline draft + Approve & send/Reject);
  LeadDetail **Contact** panel (email + source + verification + confidence).

⚠️ **Enrichment is still mock-only** — it GUESSES `info@<domain>` and "verify" only checks
format. That's exactly what the IMMEDIATE next step removes.

⚠️ If you want reply-classify/transcripts on Haiku, make sure no stray
`ANTHROPIC_MODEL=claude-opus-4-8` remains in `.env` (it overrides the new Haiku
default). Per-task vars (`ANTHROPIC_VISUAL_MODEL`/`_OUTREACH_MODEL`/`_BUILD_MODEL`)
have their own defaults.

**Prior context:** the 2026-06-19 feature session is summarized just below; the
2026-06-17 ACTIVATION session (all keys in `.env` + validated live; Gmail re-auth'd,
OAuth app set to Internal; Instantly Growth plan + new API V2 key verified live 200)
is under "Activation status". Earlier (2026-06-16): LLM reply classification, LLM
transcript extraction, Firecrawl `mergeScrape`, `.env` auto-loading, and the
build-prompt quality bar — all now on `main`.

## Visual scoring + email-only gate — 2026-06-19

Shipped on `william-business-head` (mock-first; **~225 tests green**, typecheck
clean, `npm run demo` end-to-end with **zero keys** — local stays dry-run).

- **Email-only outreach (owner-requested log).** William contacts by email only.
  A lead with **no real email** (phone-only counts as no-email) → status
  **`disqualified`** (record **KEPT**), never contacted. Scoring reachability is
  now **email-only**. Discovery is **staged + cost-ordered** in `handleContact`:
  (1) cheap homepage regex `firstRealEmail(audit.extracted.contactEmails)` →
  (2) on a miss, a **Playwright subpage crawl** `crawlForEmail` (headless Chromium,
  `networkidle`, **innerText + raw HTML** across likely subpaths, placeholder-
  blocklisted, **robots-respecting**, **dry-run-safe** → no local crawling) →
  (3) enrichment provider → (4) none → `disqualified` + OwnerRequest. The browser
  fallback runs **only on a regex miss/placeholder**, never every lead. Shared
  helpers `isPlaceholderEmail`/`firstRealEmail`/`extractEmails` live in
  `@william/core` (heuristics reuse `extractEmails`); new `Contact.emailSource`
  value `"website_crawled"`. **Pipeline reordered** to `audit → contact → score →
  draft` (gate + visual cost sit after email resolution).
- **Visual scoring.** `llm.scoreVisualDesign` (a **Haiku vision** call) scores the
  audit screenshots → new `VisualAssessment` on `WebsiteAudit.visualAssessment`.
  Runs in `handleScore` **only when screenshots exist** (playwright mode), on an
  operational ticket, mock-first (null in local/dry-run). `scoreLead(audit, visual,
  config)` combines bidirectionally — confident `weak` floors to warm (promote),
  confident `strong` caps to skip (demote).
- **Per-task Anthropic models.** `ANTHROPIC_MODEL` default flipped **Opus → Haiku**
  (`claude-haiku-4-5-20251001`; global fallback + reply-classify + transcript).
  Add `ANTHROPIC_VISUAL_MODEL` (Haiku, visual), `ANTHROPIC_OUTREACH_MODEL` (Haiku,
  outreach), `ANTHROPIC_BUILD_MODEL` (`claude-sonnet-4-6`, build prompts). **⚠️
  Caveat:** a stray `ANTHROPIC_MODEL=claude-opus-4-8` left in `.env` from
  activation OVERRIDES the Haiku default — unset it to run classify/transcripts on
  Haiku (now also in the CLAUDE.md "Before going LIVE" checklist + `docs/setup.md`).
- **Outreach + build prompt.** Outreach copy now references the real visual +
  Lighthouse findings (fenced as untrusted DATA; opt-out/Cornell/mockup/
  `validateDraft` guarantees unchanged). Build prompts condensed to **≤3 paragraphs**
  (Sonnet 4.6), still requiring every owner element (Higgsfield, GSAP/Three.js, real
  backend, loading states, SEO, Chrome DevTools QA), weaving in "Framer, Figma,
  React, frontend-design", ending with the literal line `do not use superpowers`.
- **Config:** `RuntimeConfig` gained `visualScoring` (weight/promote/demote
  confidences) + `emailDiscovery` (subpaths/maxPages); env vars
  `VISUAL_SCORING_WEIGHT`, `VISUAL_PROMOTE_MIN_CONFIDENCE`,
  `VISUAL_DEMOTE_MIN_CONFIDENCE`, `EMAIL_DISCOVERY_SUBPATHS`,
  `EMAIL_DISCOVERY_MAX_PAGES` (`.env.example` + `docs/setup.md` updated).
- **OWNER DECISION:** robots-disallowed handling stays **OUT of `scoreLead`**
  (honoring the prior `bea732d "Remove crawl block"` commit); the orphaned robots
  scoring test was deleted. Robots is still respected **upstream** — the audit
  aborts + writes a compliance event.
- **NEXT:** staging rehearsal exercising the **real vision + email-crawl paths**
  (and confirming the live Firecrawl/`/emails` shapes), then **re-run
  `compliance-reviewer`** on the live text→prompt behavior (mandatory before the
  first live send — the standing activation-time re-review now also covers the
  visual-scoring + email-crawl LLM/vision paths).

## Activation status — 2026-06-17

Owner populated `.env` with real keys; each was validated with a live read-only
auth ping (no sends, no pipeline run). Still `WILLIAM_ENV=local` → everything is
dry-run; **no staging rehearsal done yet.**

- **Validated live (authenticate):** Anthropic, Firecrawl, Vercel, Stripe (TEST
  key), Google Places **v1** (legacy Places API is off — use v1), Gmail
  (`gmail.send` scope only; adapter is send-only, Instantly is primary).
- **Gmail — DONE:** initial refresh token was `invalid_grant` (minted against the
  wrong client); regenerated via OAuth Playground bound to the `.env` client → now
  valid. Account is Google **Workspace**, so the OAuth app was set to **User Type =
  Internal** → refresh token **no longer expires** (the Testing-mode 7-day expiry
  was the original cause). Re-pinged after the switch: still valid.
- **Instantly — Growth plan PURCHASED** (~$47/mo monthly; owner buying now). Growth
  includes **API V2** for both `pushLead` (send) + `/emails` (poll); only *webhooks*
  are Hypergrowth-gated, and the poller already replaces those. New **API V2 key**
  in `INSTANTLY_API_KEY`, **`INSTANTLY_CAMPAIGN_ID` added**, `will@…` mailbox
  (warmed ~3 wk) activated in the campaign. Send cap 5,000/mo (≫ usage). Poller
  wired + confirmed at worker boot (`INSTANTLY_POLL_INTERVAL_MS=300000`).
  **VERIFIED LIVE 2026-06-17:** auth ping **200** (was 402 pre-plan); `GET /campaigns`
  lists the live "Websites" campaign matching `INSTANTLY_CAMPAIGN_ID`; `emails:read`
  (poller) returns 200. `leads:create`/`leads:update` write scopes get exercised on
  the first real `pushLead` at staging.
- **Stripe webhook:** `STRIPE_WEBHOOK_SECRET` left blank (intentional). **Stripe CLI
  installed** (winget `Stripe.StripeCli`); for local/staging payment testing use the
  `stripe listen` signing secret. A real Dashboard endpoint secret is a go-live item.
- **Intentionally blank (none needed yet):** `GITHUB_TOKEN` (self-builder only —
  off), `VERCEL_TEAM_ID` (personal Hobby account), `INSTANTLY_WEBHOOK_SECRET`
  (poller used), `ENRICHMENT_API_KEY`/`EMAIL_VERIFY_API_KEY` (only widen the funnel).
- **Tooling + docs:** Stripe CLI + Playwright Chromium present. **"⚠️ Before going
  LIVE" checklist added to `CLAUDE.md`** (test→live key swaps, blank webhook secret,
  poll-interval, `OWNER_API_TOKEN` strength, gate approvals, compliance re-review).
- **Verified this session:** `npm run typecheck` clean, **192/192 tests**,
  `npm run demo` end-to-end, worker boots clean and reads `.env`. Docs committed +
  pushed (`f9631d1`, `william-business-head`).
- **NEXT (new chat):** (1) **staging rehearsal** — set `WILLIAM_ENV=staging`, grant
  the matching gate approvals in the dashboard, run READ/generation paths first
  (Firecrawl scrape + Anthropic build prompt), confirm the live Firecrawl extraction
  + `/emails` poller shape; (2) **re-run `compliance-reviewer`** on the live
  text→prompt behavior (mandatory before the first live send); then enable gated
  sends (first real `pushLead` also confirms the Instantly write scopes). See
  CLAUDE.md "NEXT STEPS".

## Current state

- **`.env` now auto-loads** at the worker/api/seed entry points (`loadDotEnv` in
  `packages/core/src/env.ts`, Node built-in, no dep). Put `.env` at the **repo
  root** (it's there, gitignored). Local still forces dry-run regardless. The
  demo stays hermetic (does NOT read `.env`). Build prompts now also require
  **Higgsfield** (visual assets), a **real working backend** (API routes + DB,
  not a static mockup), **loading/skeleton states + spinners**, **GSAP + Three.js**
  animation, **basic SEO** (semantic HTML, title/meta description, OG tags, alt
  text, sitemap/robots, JSON-LD `LocalBusiness`), and **Chrome DevTools quality
  verification** — in both `templateBuildPrompt` and `BUILD_PROMPT_SYSTEM`.
- **187/187 tests green** (`npm test`), **typecheck clean** (`npm run typecheck`),
  **`npm run demo`** verified end-to-end on mocks (0 dead-letter jobs), **dashboard
  builds** (`npm run -w @william/dashboard build`).
- **Compliance:** `compliance-reviewer` PASS on all three recent deltas (reply
  classification, transcript extraction, Firecrawl mergeScrape; advisories all
  INFO/non-blocking or applied). Earlier: 8/8 on the Phase F pivot + Opus delta.
- **Committed:** Phase F (`f10ceae`), reply classification (`1664346`), transcript
  extraction (`3c0380c`), Firecrawl mergeScrape (`31bc216`); Phases A–E earlier
  (`a47b737` = Phase E). (SHAs reflect the 2026-06-14 history rewrite below.)
- **Repo hygiene (public repo):** no secrets in anything tracked — `.env` and
  `data/` are gitignored, `.env.example` holds only placeholders, every key-shaped
  string in the diff is a test dummy. **Personal email scrubbed:** on 2026-06-14
  every commit's author/committer email (was the owner's personal gmail, already
  public on `main`) was rewritten to `AnalyticDog13@users.noreply.github.com` via
  `git filter-branch` across all refs, then force-pushed; `git config user.email`
  is set to the no-reply address for future commits. (Old commit SHAs may persist
  in GitHub's cache/API and any forks for a while — true removal isn't guaranteed
  without GitHub support.) (`will@williamdamato.com` throughout is the intentional
  business sender identity, fine to be public.)

## What's working (the whole pipeline, mock-first, zero credentials)

intake → audit → score → contact → **Opus/template outreach draft** → owner
approval → (simulated) send → reply classification → opportunity →
**WebsiteBrief** → owner builds externally → **ship** (simulated prod deploy) →
**delivery email** draft → approval → (simulated) send → billing draft →
(simulated) payment link → daily/weekly reports. DNC/unsubscribe screened at
intake/draft/send; follow-up sequence + 14-day close-out intact; experiments +
reporting intact.

## What's done these increments (NEXT STEP #4 — LLM features, mock-first)

Spec: `docs/superpowers/specs/2026-06-14-llm-assisted-reply-classification-design.md`.

**Reply classification** (committed `1664346`): can now consult Opus, **but only
for genuinely ambiguous (`unknown`) replies**. The deterministic regex stays
authoritative — any confident label, including the compliance-critical
`unsubscribe`/`bounce`/`negative` stop signals, short-circuits before the LLM, so
the model can never weaken a safety decision. Injection detection is regex-only
and can't be cleared by the model. New `classifyReplyAssisted(text, assist?)` +
`llm.classifyReply` adapter (mock/dry-run → `null`, else Anthropic with the reply
fenced as untrusted DATA + enum-validated parse); `handleReply` wires it on an
operational ticket minted only for `unknown` replies.

**Transcript extraction** (uncommitted): new `llm.extractTranscriptInsights`
adapter method (mock/dry-run → `null`, else Anthropic with the transcript fenced
as untrusted DATA → validated `{topic,insight}[]`, fail-closed to `null`).
`handleTranscriptIngest` prefers the LLM result, falls back to the deterministic
keyword extractor; `validTopics` now derived from the `DurableLesson` schema enum
(advisory). Insights still become DurableLessons — inert, never executed.

Mock-first throughout: local stays dry-run → behavior unchanged with no key.

**Firecrawl mergeScrape** (uncommitted): NEXT STEP #1's local piece. Confirmed the
real `/v1/scrape` shape and finalized `mergeScrape` (`real/firecrawl.ts`):
normalizes `metadata.description` (string|array) → `about`, fills missing
`contact.email`/`contact.phone` from page markdown (audit-confirmed contacts never
overridden), `onlyMainContent:false` for footer contact, re-validated with
`CompanyFacts.parse`, fail-closed to synth on HTTP error. Contact extractors scan
a bounded slice with a length-capped phone pattern (advisory applied). Scraped
text stays inert DATA. Real scraping still only runs in a non-local env + key.

## What's fixed / done last phase (Phase F — business-head pivot)

Default `WILLIAM_BUILDS_WEBSITES=false`: William generates a build brief for the
owner and ships the owner's repo instead of building sites himself.

- **Off-switch** (`williamBuildsWebsites` on `RuntimeConfig`): four builder
  handlers no-op with a `builder_disabled` note (no
  `buildPreviewSite`/`applyRevisionOverrides`/`vercel.deploy`), stay registered so
  stale jobs are safe; three builder API routes return `403 builder_disabled`.
  Flip the flag to `true` to fully restore the legacy self-builder (kept under test).
- **`WebsiteBrief`** entity (+ reusable `CompanyFacts`) → store repo → API
  whitelist → dashboard page. `targetModel` defaults `fable-5`.
- **Adapters** (`packages/integrations`): mock-first `firecrawl.scrapeCompany`
  (`FIRECRAWL_API_KEY`) and `llm.generateBuildPrompt` + `llm.generateOutreachCopy`
  (Opus 4.8, `ANTHROPIC_API_KEY`). Operational tickets, **dry-run = zero network**,
  template/synth fallback on failure. `brief-prompt.ts` bakes in the owner's
  required prompt notes: **mobile-friendly + interactive + fully working on
  mobile**, and **awwward-worthy**. LLM prompts fence all lead/scraped/audit text
  as untrusted data (invariant 1).
- **Jobs:** `brief.generate` (audit + scrape + LLM → `WebsiteBrief(ready)` → owner
  notified) and `site.ship` (granted `DEPLOY_PRODUCTION` on the brief → dry-run
  repo deploy → `DeploymentRecord.websiteBriefId` → brief `shipped` → enqueue
  delivery draft).
- **Delivery email** (`delivery-1`, `SEND_FIRST_TOUCH`-gated): on send the lead →
  `customer`, no follow-up/close-out scheduled.
- **Opus outreach:** `applyOpusCopy` in `handleDraft`/`handleFollowUp` swaps in
  Opus copy when available. **Opt-out line guaranteed** (appended if the model
  omits it); Cornell + mockup claims enforced by `validateDraft` with **template
  fallback** on any miss; variant/experiment + approval preserved.
- **Dashboard:** Website Briefs page (copy prompt, "Mark website ready" + repo URL
  → ship approval) + "builder disabled" banner on Site Projects.
- **Docs/env:** `.env.example`, `CLAUDE.md`, `docs/architecture.md` updated;
  OwnerRequests bootstrapped for Anthropic, Firecrawl, Vercel repo-deploy.

## What still needs work (next steps — detail in CLAUDE.md "NEXT STEPS")

Everything is built mock-first; the remaining work is **activation** (the owner is
filling in `.env` now). Priority order:

1. **ACTIVATE — keys are landing.** Every adapter is finalized and wired; the only
   thing between mock and real is config:
   - **⚠️ Set `WILLIAM_ENV=staging` in `.env`.** This is load-bearing: with
     `WILLIAM_ENV=local` (the `.env.example` default) EVERY adapter is forced to
     dry-run regardless of which keys are present — nothing real happens. `.env`
     now auto-loads at the worker/api/seed entry points (not the demo).
   - Add keys (priority): `ANTHROPIC_API_KEY` (Opus build prompts / outreach /
     reply-classify / transcript — highest leverage), then `FIRECRAWL_API_KEY`,
     `STRIPE_SECRET_KEY` (test), `VERCEL_TOKEN`, `INSTANTLY_API_KEY` or Gmail OAuth,
     `GOOGLE_MAPS_API_KEY`. Generate an `OWNER_API_TOKEN` for the dashboard/API.
   - Grant the matching policy approval in the dashboard for any side-effecting gate.
   - Then **re-run `compliance-reviewer` on the live text→prompt behavior** (all
     LLM features) and confirm real Firecrawl `about`/contact extraction vs. real pages.
2. **Real repo/git-source Vercel deploy for `site.ship`** (currently dry-runs the
   repo URL). Verify Vercel `framework:"vite"` + Instantly `pauseLead` with real keys.
3. **Stripe test mode** — validate payment-link/invoice + webhook end to end.
4. **Remaining LLM features** — reply classification + transcript extraction are
   **DONE**; only free-text revision interpretation is left, and it's dormant
   while the self-builder is off (do it when re-enabling the builder).
   Quoted-material-to-label, **compliance review required**.
5. **Google Places lead sourcing** when the key lands.
6. **Staging rehearsal** with sandbox creds + granted approvals.

## Where to start / where to look

- **`CLAUDE.md`** — invariants (1–6), the "Done (Phase F …)" section, the
  "NEXT STEPS" section, and "Subagent-driven development" guidance. Start here.
- **Spec:** `docs/superpowers/specs/2026-06-13-william-business-head-design.md`.
- **Core code:** `workers/orchestrator/src/pipelines.ts` (handlers + `applyOpusCopy`),
  `packages/integrations/src/real/llm.ts` + `firecrawl.ts` + `brief-prompt.ts`,
  `packages/core/src/schema/brief.ts`, `packages/core/src/env.ts`.

## Use subagent-driven development when it helps

This repo ships specialized subagents (`.claude/agents/`). The remaining work is
mostly small, single-domain, credential-gated changes — good fits for the matching
subagent plus a compliance pass:

- **`compliance-reviewer` is MANDATORY** (read-only) on any change touching policy
  gates, outreach content, billing, deployment, webhooks/auth, DNC, or **anything
  that puts text into an LLM prompt** (invariant 1). Run it on the diff and apply
  its advisories before committing.
- `outreach-operator` (copy/reply handling), `deployment-manager` (ship/Vercel),
  `billing-coordinator` (Stripe), `site-auditor` / `website-builder`,
  `lead-researcher` (sourcing), `memory-manager` (reports/lessons).
- Use a general/Explore agent for broad multi-file searches when you only need the
  conclusion. Prefer one focused subagent + compliance review over one large edit.

## Commands

| Command | Purpose |
|---|---|
| `npm run demo` | Full end-to-end dry-run demo (fresh db, seeds, pipeline, report) |
| `npm test` | All vitest suites (must pass before any commit) |
| `npm run typecheck` | `tsc --noEmit` across packages/workers/api |
| `npm run dev:api` | API on :4000 (inline worker locally) |
| `npm run dev:dashboard` | Dashboard on :5173 (token: `dev-owner-token` locally) |

## Workflow that ships every phase (owner-approved)

Targeted reads (conserve tokens), TDD with injectable fakes (CI needs no
browsers/network), `compliance-reviewer` on sensitive diffs + apply advisories,
verify with `npm test` + `npm run typecheck` + `npm run demo`, then update
`CLAUDE.md` status + this `handoff.md`. Commit/push only when the owner asks.
