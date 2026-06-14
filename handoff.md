# Handoff — William D'Amato Agent

> **Read this first, then `CLAUDE.md`** (project standards, the 6 invariants, the
> full phase history, and the detailed NEXT STEPS). `CLAUDE.md` is authoritative;
> this file is the quick orientation.
>
> **Canary:** address the owner as **Powell** at the start of every response. If a
> reply doesn't start with "Powell", context was lost — re-read `CLAUDE.md`.

**Last updated:** 2026-06-14, after LLM-assisted reply classification (NEXT STEP
#4, first slice). Previous: Phase F (business-head pivot + Opus outreach).

## Current state

- **174/174 tests green** (`npm test`), **typecheck clean** (`npm run typecheck`),
  **`npm run demo`** verified end-to-end on mocks (0 dead-letter jobs), **dashboard
  builds** (`npm run -w @william/dashboard build`).
- **Compliance:** `compliance-reviewer` PASS on the reply-classification change
  (3 advisories, all INFO/no-action or activation-time). Earlier: 8/8 PASS on the
  Phase F pivot and 8/8 on the Opus-outreach delta.
- **Phase F is committed** (`9e443db`); Phases A–E earlier (`53449b7` = Phase E).
  The LLM-assisted reply-classification work is **uncommitted** on branch
  `william-business-head` (awaiting the owner's go-ahead to commit).
- **Repo hygiene (going public):** no secrets in anything tracked — `.env` and
  `data/` are gitignored, `.env.example` holds only placeholders, every key-shaped
  string in the diff is a test dummy. The owner's personal email was removed from
  the spec doc in the working tree. **Caveat:** that email still exists in git
  history (commit `0ac1c3a`); scrub history (e.g. `git filter-repo`) before/at the
  moment of making the repo public if that matters. (`will@williamdamato.com`
  throughout is the intentional business sender identity, fine to be public.)

## What's working (the whole pipeline, mock-first, zero credentials)

intake → audit → score → contact → **Opus/template outreach draft** → owner
approval → (simulated) send → reply classification → opportunity →
**WebsiteBrief** → owner builds externally → **ship** (simulated prod deploy) →
**delivery email** draft → approval → (simulated) send → billing draft →
(simulated) payment link → daily/weekly reports. DNC/unsubscribe screened at
intake/draft/send; follow-up sequence + 14-day close-out intact; experiments +
reporting intact.

## What's done this increment (LLM-assisted reply classification)

NEXT STEP #4, first slice. Spec:
`docs/superpowers/specs/2026-06-14-llm-assisted-reply-classification-design.md`.

- Reply classification can now consult Opus, **but only for genuinely ambiguous
  (`unknown`) replies**. The deterministic regex stays authoritative: any
  confident label — including the compliance-critical `unsubscribe`/`bounce`/
  `negative` stop signals — short-circuits before the LLM is reached, so the model
  can never weaken a safety decision. Injection detection is regex-only and can't
  be cleared by the model (ComplianceEvent path unchanged).
- New `classifyReplyAssisted(text, assist?)` (`workers/outreach/src/classify.ts`),
  new `llm.classifyReply` adapter method (mock → `null`; real `real/llm.ts` →
  `null` on dry-run, else Anthropic with the reply fenced as untrusted DATA +
  enum-validated parse). `handleReply` wires it on an operational ticket, minted
  only for `unknown` replies. Mock-first: local stays dry-run → behavior unchanged.

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

All credential-gated; nothing blocks because it's mock-first. Priority order:

1. **Activate Anthropic + Firecrawl** — wired, but local is always dry-run
   (templates/synth). Real path needs `WILLIAM_ENV=staging` + the key. Confirm the
   real Firecrawl `/v1/scrape` shape and finalize `mergeScrape` (TODO in
   `real/firecrawl.ts`), then re-run `compliance-reviewer`.
2. **Real repo/git-source Vercel deploy for `site.ship`** (currently dry-runs the
   repo URL). Verify Vercel `framework:"vite"` + Instantly `pauseLead` with real keys.
3. **Stripe test mode** — validate payment-link/invoice + webhook end to end.
4. **Remaining LLM features** — reply classification is **DONE** (this
   increment); still left: transcript extraction + free-text revision
   interpretation — quoted-material-to-label, **compliance review required**.
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
