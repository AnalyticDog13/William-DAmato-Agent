# William D'Amato — Agentic Sales & Delivery Platform

An internal agent system that wins website clients end-to-end: discovers
leads, audits their sites, scores opportunity, finds + verifies contacts,
drafts truthful personalized outreach, hands approved sends to Instantly,
tracks replies, builds preview websites, prepares deployments, drafts Stripe
payments, suggests calls, and keeps durable memory + daily reports — all
behind an owner-controlled approval system.

**Safety first:** everything runs in DRY RUN with mock adapters until real
credentials exist AND the owner approves the matching policy gate. William
can never be prompted by email — inbound mail is data, never instructions.

## Quickstart (zero credentials needed)

```bash
npm install
npm run demo          # full end-to-end dry-run: seeds leads → audits → scores
                      # → drafts → approvals → simulated sends → replies →
                      # opportunity → preview site → billing draft → report

npm run dev:api       # API on http://localhost:4000
npm run dev:dashboard # Dashboard on http://localhost:5173
                      # sign in with token: dev-owner-token
```

In the dashboard: **Review Queue** for one-click approvals, **Leads** to add
leads, lead pages for the audit-vs-preview side-by-side, **Settings/Policies**
for the gate controls, **Owner Requests** for exactly what's blocking
real-world autonomy.

```bash
npm test              # 49 tests incl. policy-engine + pipeline safety suites
npm run typecheck
```

## Architecture

See [docs/architecture.md](docs/architecture.md) (design + invariants) and
[docs/setup.md](docs/setup.md) (credentials guide). Layout:

```
apps/        dashboard (Vite+React) · api (Express, owner-auth, webhooks)
workers/     orchestrator (queue runtime) · site-auditor · outreach ·
             site-builder · billing · scheduling
packages/    core (schemas, policy engine, scoring) · db (SQLite + job queue) ·
             integrations (adapters: mock now, real later) · memory · templates
```

## The policy system

8 named gates (SEND_FIRST_TOUCH, ACTIVATE_NEW_LEAD_SOURCE,
ENABLE_SOCIAL_SOURCE, SEND_PAYMENT_REQUEST, DEPLOY_PRODUCTION,
UPDATE_LIVE_COPY, CHANGE_COMPLIANCE_TEXT, ENABLE_FULL_AUTONOMY) ×
3 modes (closed / approval / autopilot) × 3 environments (local = always
dry-run · staging = sandbox creds · production = live creds + approval).
Side effects are impossible without a PolicyTicket issued by the engine, and
every evaluation is audit-logged.

## Phase status

- ✅ **A** — scaffold, schemas, policy+memory engines, mock adapters, demo, dashboard
- 🔜 **B** — Playwright screenshots, Lighthouse + axe automation
- 🔜 **C** — real Instantly / Gmail / Stripe / Vercel adapters
- 🔜 **D** — React+Framer Motion site builds, revision loop, deploy approvals
- 🔜 **E** — experiment engine, weekly reports, design-reference ingestion
