# William D'Amato — Agentic Sales & Delivery Platform

An autonomous agent that wins website clients end-to-end — and a study in how to
let an LLM-driven system take real business actions **safely**. It discovers
leads, audits their sites (Lighthouse + accessibility + screenshots), scores the
opportunity, finds and verifies contacts, writes truthful personalized outreach,
handles replies and follow-ups, and — on a positive reply — produces a complete
website **build brief** for a human to build, then ships the finished site and
drafts the delivery email. Every outward action passes through an
owner-controlled approval system.

> **Safety is the point.** Everything runs in **dry-run with mock adapters** until
> real credentials exist *and* the owner approves the matching policy gate. No
> side effect is possible without a cryptographic-style **PolicyTicket** issued by
> the engine. And the agent **can never be prompted by email** — inbound mail and
> scraped pages are treated strictly as data, never as instructions.

TypeScript monorepo · zod schemas as the source of truth · SQLite + durable job
queue · mock-first integrations · **158 passing tests**, all green with zero
credentials.

## Quickstart (no credentials needed)

```bash
npm install
npm run demo          # full end-to-end dry-run: seeds leads → audit → score →
                      # contact → Opus/template outreach → owner approval →
                      # simulated send → reply → opportunity → website brief →
                      # ship (simulated) → delivery email → billing → report
npm test              # 158 tests incl. the policy-engine + pipeline safety suites
npm run typecheck

npm run dev:api       # API on http://localhost:4000
npm run dev:dashboard # Dashboard on http://localhost:5173 (token: dev-owner-token)
```

The dashboard: **Review Queue** for one-click approvals, **Leads** to add leads,
**Website Briefs** to copy a build prompt and ship a finished site, lead pages
for the audit timeline, **Settings/Policies** for the gate controls, and **Owner
Requests** for exactly which credentials would unlock real-world autonomy.

## How it works: William is the *business head*

By default (`WILLIAM_BUILDS_WEBSITES=false`) William runs the business side and
**hands the actual web design to a human**:

1. **Find & qualify** — intake → site audit → opportunity score → contact discovery + verification.
2. **Reach out** — short, truthful, personalized outreach (Opus-generated when a
   key is present, deterministic templates otherwise). Every draft is owner-approved
   and carries a one-line opt-out; DNC/unsubscribe is screened at intake, draft, and send.
3. **Convert** — replies are classified; a positive reply opens an opportunity and
   notifies the owner immediately.
4. **Brief** — William generates a full **WebsiteBrief**: a build prompt (real
   scraped company facts + audit weaknesses + recommended animation-forward stack,
   always required to be mobile-friendly, interactive, and "awwward-worthy") for
   the owner to build on a code-gen model.
5. **Ship & deliver** — the owner pastes the finished repo URL; William deploys it
   (behind the `DEPLOY_PRODUCTION` gate) and drafts the delivery email.

The original self-builder (React/Framer Motion preview generation, revision loop,
Vercel preview/prod deploys) is **preserved behind the flag** — flip
`WILLIAM_BUILDS_WEBSITES=true` to restore it unchanged.

## The safety model (the interesting part)

- **Policy engine — 8 named gates × 3 modes × 3 environments.** Gates:
  `SEND_FIRST_TOUCH`, `ACTIVATE_NEW_LEAD_SOURCE`, `ENABLE_SOCIAL_SOURCE`,
  `SEND_PAYMENT_REQUEST`, `DEPLOY_PRODUCTION`, `UPDATE_LIVE_COPY`,
  `CHANGE_COMPLIANCE_TEXT`, `ENABLE_FULL_AUTONOMY`. Modes: closed / approval /
  autopilot. Environments: local (always dry-run) · staging (sandbox creds) ·
  production (live creds + approval). Adapters throw without a PolicyTicket; every
  evaluation is audit-logged.
- **Prompt-injection defense (invariant 1).** Scraped sites, audit text, and
  inbound replies enter an LLM prompt only as fenced, quoted material the model is
  told never to obey. Injection-looking replies are flagged to a compliance log,
  never executed.
- **Mock-first, credential-gated.** Real adapters (Instantly, Stripe, Gmail,
  Vercel, Firecrawl, Anthropic/Opus) activate by credential presence but still
  simulate under dry-run — so a key in a local `.env` is side-effect-free.
- **Compliance review as a build step.** Every change touching policy, outreach
  content, billing, deployment, or LLM prompts is reviewed by a read-only
  `compliance-reviewer` agent before it lands.

## Architecture

See [docs/architecture.md](docs/architecture.md) (design + invariants) and
[docs/setup.md](docs/setup.md) (credentials guide). Layout:

```
apps/        dashboard (Vite + React) · api (Express, owner-auth, HMAC webhooks)
workers/     orchestrator (durable queue runtime, pipeline routing) ·
             site-auditor · outreach · site-builder · billing · scheduling
packages/    core (zod schemas, policy engine, scoring, env) ·
             db (SQLite store + job queue) · integrations (mock + real adapters,
             incl. Opus 4.8 + Firecrawl) · memory · templates
```

zod schemas in `packages/core/src/schema/` are the source of truth — the DB layer
validates on read *and* write. Every pipeline action carries a `traceId`; every
lead-visible step writes an activity event; failures are categorized into a memory
taxonomy.

## Status — Phases A–F complete (158 tests green)

- ✅ **A** — scaffold, schemas, policy + memory engines, mock adapters, demo, dashboard
- ✅ **B** — Playwright screenshots, Lighthouse + axe-core automation (graceful fallback)
- ✅ **C** — real Instantly / Gmail / Stripe / Vercel adapters (credential-selected)
- ✅ **D** — React + Framer Motion site builds, revision loop, deploy approvals
- ✅ **E** — experiment engine, weekly reports, transcript→lesson ingestion
- ✅ **F** — business-head pivot: WebsiteBrief generation, owner-ship flow,
  Opus-generated outreach + build prompts (Firecrawl + Anthropic adapters)

Next: activating the credential-gated real paths (Opus/Firecrawl, real repo
deploy, Stripe test mode, lead sourcing) — all mock-first today. See `CLAUDE.md`
for the detailed roadmap.

---

*Built as a study in safe agentic automation. The demo data is fictional; no real
businesses or contacts are included.*
