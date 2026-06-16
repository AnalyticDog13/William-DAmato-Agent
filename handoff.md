# Handoff — William D'Amato Agent

> **Read this first, then `CLAUDE.md`** (project standards, the 6 invariants, the
> full phase history, and the detailed NEXT STEPS). `CLAUDE.md` is authoritative;
> this file is the quick orientation.
>
> **Canary:** address the owner as **Powell** at the start of every response. If a
> reply doesn't start with "Powell", context was lost — re-read `CLAUDE.md`.

**Last updated:** 2026-06-16, end of the build session. Built this session
(all committed + pushed to `william-business-head`, history scrubbed of the
owner's personal email): LLM reply classification, LLM transcript extraction,
Firecrawl `mergeScrape`, `.env` auto-loading, and the build-prompt quality bar
(Higgsfield + real backend + loading states + GSAP/Three.js + basic SEO + Chrome
DevTools QA). **Owner is filling in `.env` now → next session is ACTIVATION**
(see step 1 below; `WILLIAM_ENV=staging` is the load-bearing switch).

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
