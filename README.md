# William D'Amato — Outreach Tool

A focused business-outreach tool. It sources local businesses from Google Maps, finds a real contact email (cheaply, first), audits and scores the website, writes a short personalized email, and pushes the lead to Instantly for sending.

The owner handles everything after the push — reading replies, follow-ups, booked calls, payment, and any website building.

> **Safety first.** Everything runs in dry-run until real credentials exist *and* the owner approves the matching policy gate. No push to Instantly is possible without a PolicyTicket issued by the engine. Scraped pages and audit text are treated strictly as data, never as LLM instructions.

TypeScript monorepo · zod schemas as source of truth · SQLite + durable job queue · mock-first adapters · **zero credentials needed to run the demo**.

## Quickstart (no credentials needed)

```bash
npm install
npm run demo          # end-to-end dry-run: source → contact → audit → score → draft → (simulated) push
npm test              # full suite, including policy-engine + pipeline safety suites
npm run typecheck

npm run dev:api       # API on http://localhost:4000
npm run dev:dashboard # Dashboard on http://localhost:5173 (token: dev-owner-token)
```

Dashboard pages: **Source Leads** (city/niche or batch-sweep + runs list) and **Leads** (table with inline email + Approve & push / Reject in review mode).

## How it works

1. **Source** — Google Places New API (`POST /v1/places:searchText`) finds local businesses matching a niche + city. Normal mode stops at N qualified leads. Batch mode sweeps all niches up to a business cap.
2. **Contact** — plain HTTP GET of the homepage HTML; regex-extracts and ranks emails (`bestBusinessEmail`). On a miss: Playwright subpage crawl (`crawlForEmail`). Still a miss: enrichment provider (if configured). No email found → lead is `disqualified` (record kept), no audit run.
3. **Audit** — full Playwright audit (desktop + mobile screenshots, Lighthouse, axe-core, heuristics) — only runs once an email is found.
4. **Score** — `scoreLead` + optional Haiku visual scoring (when screenshots exist). Score > `OUTREACH_SCORE_THRESHOLD` (default 45) → proceed. Score ≤ threshold → stopped, not emailed. Higher score = worse site = better prospect.
5. **Draft** — deterministic template email: ≤5 sentences, Cornell-student voice, plain language (no jargon), free-mockup hook, P.S. opt-out, no URL.
6. **Push** — `PUSH_MODE=review` (default): owner clicks **Approve & push** in the dashboard. `PUSH_MODE=auto`: auto-pushed after DNC screening. Instantly receives `first_name`, `company`, `email_subject`, `email_body` as custom variables.

DNC/unsubscribe is screened at intake, draft, and push. Local env is always dry-run.

## Two settings

Both env-overridable, defined in `packages/core/src/env.ts` (`RuntimeConfig`):

| Setting | Default | Meaning |
|---|---|---|
| `OUTREACH_SCORE_THRESHOLD` | `45` | Only sites scoring ABOVE this are emailed. Higher score = worse site = better prospect. |
| `PUSH_MODE` | `"review"` | `review`: owner approves each push. `auto`: auto-pushed after DNC screen. |

Start on `review` to vet the first ~50 leads and emails, then flip to `auto`.

## Instantly campaign setup

The owner's Instantly campaign template must use these custom variables:

```
Subject: {{email_subject}}
Body:    {{email_body}}
```

William pushes `first_name`, `company`, `email_subject`, and `email_body` with every lead. The campaign template is just the two placeholders — William writes the full email.

## Credentials needed for real runs

- `GOOGLE_MAPS_API_KEY` — Google Places New API (`/v1`; legacy Places is off).
- `INSTANTLY_API_KEY` + `INSTANTLY_CAMPAIGN_ID` — API V2 key with `leads:create` scope.
- `ANTHROPIC_API_KEY` — Haiku visual scoring (optional; scoring falls back to heuristics-only without it).
- `ENRICHMENT_API_KEY` / `EMAIL_VERIFY_API_KEY` — optional; unblocks leads with no published email.
- `OWNER_API_TOKEN` — owner auth for the dashboard and API.

Set `WILLIAM_ENV=staging` for a staging rehearsal (real paths, sandbox credentials); `WILLIAM_ENV=production` only after a real lead flows end-to-end in staging.

## Commands

| Command | Purpose |
|---|---|
| `npm run demo` | End-to-end dry-run demo (stop the worker first if it's running) |
| `npm test` | All vitest suites |
| `npm run typecheck` | `tsc --noEmit` across packages/workers/api |
| `npm run dev:api` | API on :4000 |
| `npm run dev:dashboard` | Dashboard on :5173 (token: `dev-owner-token` locally) |
| `npm run worker` | Continuous queue worker (staging/production) |
| `npm run seed` | Seed demo data into the persistent db |

## Architecture

```
apps/        dashboard (Vite + React) · api (Express, owner-auth)
workers/     orchestrator (pipeline routing, durable queue) · site-auditor · outreach
packages/    core (zod schemas, policy engine, scoring, env) ·
             db (SQLite store + job queue) · integrations (mock + real adapters) ·
             memory
```

zod schemas in `packages/core/src/schema/` are the source of truth — the DB layer validates on read *and* write. Every pipeline action carries a `traceId`; failures are categorized in a memory taxonomy.

## Safety model

- **Policy engine — named gates.** `SEND_FIRST_TOUCH` (the Instantly push), `ACTIVATE_NEW_LEAD_SOURCE`, `CHANGE_COMPLIANCE_TEXT`, and others. Every evaluation is audit-logged. Adapters throw without a PolicyTicket.
- **Prompt-injection defense.** Scraped content and audit text enter an LLM only as fenced, quoted material the model is told never to obey. This is a non-negotiable invariant.
- **DNC/unsubscribe absolute.** Screened at intake, draft, and push. Opt-outs are honored immediately.
- **Mock-first.** Real adapters activate by credential presence but still simulate under dry-run — a key in a local `.env` is side-effect-free.
- **Compliance review.** Every change touching policy, outreach content, or anything that puts text in an LLM prompt is reviewed by the read-only `compliance-reviewer` subagent before it lands.

---

*The demo data is fictional; no real businesses or contacts are included.*
