# William D'Amato — Master Architecture Plan

> Agentic sales-and-delivery platform that wins website clients by automating lead
> discovery, site auditing, personalized outreach, preview generation, review
> workflows, deployment prep, billing drafts, scheduling support, and durable
> memory/reporting — under strict owner-approval gates.

## 1. Non-negotiable invariants

1. **William D'Amato can NEVER be prompted by email.** Inbound email is *data*
   (classified, summarized, state-tracked) — never instructions. The reply
   pipeline strips and ignores any imperative content; no email content ever
   reaches an LLM prompt as an instruction channel, only as quoted material to
   classify.
2. **DRY RUN / SAFE MODE by default.** Every adapter that produces an external
   side effect (email send, Instantly sync, Stripe link, Vercel deploy,
   Higgsfield generation) runs in dry-run until (a) valid credentials exist and
   (b) the relevant policy gate is approved.
3. **High-risk actions require explicit approval gates:** first-touch sends,
   payment requests, production deploys, new data-source activation.
4. **Hidden URLs are not security.** All authorization is enforced server-side
   on every route. Sessions, HTTPS-readiness, security headers, rate limiting,
   webhook signature verification.
5. **Do-not-contact and unsubscribe records are absolute.** The outreach
   pipeline refuses matching targets before any draft or send.
6. **Blocked ≠ stuck.** Anything blocked on missing credentials/accounts emits
   a concrete `OwnerRequest` describing exactly what unblocks it.

## 2. Technology choices

| Concern            | Choice                               | Rationale |
|--------------------|--------------------------------------|-----------|
| Language           | TypeScript everywhere                | Per spec; one toolchain |
| Monorepo           | npm workspaces                       | Zero extra tooling on owner's machine |
| Runtime DB         | SQLite via built-in `node:sqlite`    | Durable structured memory, no native deps, trivially portable; Postgres swap later via repository layer |
| Schemas            | zod                                  | Runtime validation + inferred static types |
| Workflow engine    | In-repo durable job queue on SQLite  | Retries, backoff, scheduled jobs, trace ids, observable in dashboard. Temporal-shaped interface so a managed engine can replace it later |
| API                | Express 5                            | Boring, auditable middleware chain |
| Dashboard          | Vite + React SPA                     | Fast internal UI; talks only to the authenticated API |
| Browser automation | Playwright (adapter-gated)           | Screenshots, page extraction; mock auditor used until browsers installed |
| Quality checks     | Lighthouse + axe (adapter-gated)     | Real in staging; heuristic/mock locally |
| Email              | Gmail API (will@williamdamato.com) + Instantly v2 | Both behind adapters; mocks until credentials |
| Payments           | Stripe Payment Links / Invoicing     | Draft-only until SEND_PAYMENT_REQUEST approved |
| Deploys            | Vercel preview → approval → prod     | Per spec |
| Visual generation  | Higgsfield MCP via adapter           | Dry-run + approval-required until limits confirmed |
| Tests              | vitest (+ Playwright e2e later)      | |

## 3. Repository layout

```
apps/
  dashboard/        Vite+React internal dashboard (owner-only)
  api/              Express REST API (auth, RBAC, rate limits, webhooks)
workers/
  orchestrator/     Main runtime: job queue processing, pipeline routing,
                    approval gating, memory writes, report generation, demo CLI
  site-auditor/     Crawl, screenshots, Lighthouse, a11y, content extraction,
                    heuristic recommendations
  outreach/         Draft generation, personalization, Instantly sync,
                    reply classification, owner notifications
  site-builder/     Template selection, company-data ingestion, preview
                    generation, revision loop, deployment prep
  billing/          Stripe draft creation + payment webhook handling
  scheduling/       Free/busy checks, suggested times, owner notification
packages/
  core/             Shared types, zod schemas, policy engine, approval engine,
                    audit logging, lead scoring, dedupe, task-queue domain
  db/               node:sqlite database, migrations, typed repositories
  integrations/     Adapter interfaces + mock + (later) real implementations:
                    instantly, gmail, vercel, github, stripe, enrichment,
                    calendar, transcripts, places (Google Maps), higgsfield
  memory/           Runtime business memory: daily notes, durable lessons,
                    experiments, owner-request queue, recommendations
  templates/        Vertical starter kits (barbershop, fashion, photographer,
                    coffee shop, restaurant) + template scoring/selection
docs/               architecture.md (this file), setup.md, runbooks
.claude/agents/     Build-time subagents (lead-researcher, site-auditor, …)
data/               SQLite db + generated artifacts (gitignored)
```

**Build-time vs runtime memory.** `.claude/` + `CLAUDE.md` + docs are
*build-time* memory for Claude Code working on this repo. The SQLite database
(`DailyMemory`, `DurableLesson`, `Experiment`, `OwnerRequest`, …) is *runtime*
business memory written by the orchestrator. They never mix.

## 4. Domain model

All entities are zod schemas in `packages/core/src/schema/`, persisted via
typed repositories in `packages/db`. Entities:

Lead, Contact, Company, WebsiteAudit, LeadScore, OutreachDraft, CampaignSync,
ReplyEvent, Opportunity, SiteProject, SiteRevision, ApprovalRequest,
DeploymentRecord, InvoiceDraft, PaymentRecord, CallSuggestion, BookingRecord,
FailureLog, Experiment, ExperimentResult, DailyMemory, DurableLesson,
OwnerRequest, IntegrationCredentialStatus, ComplianceEvent, UnsubscribeRecord,
DoNotContactRecord — plus infrastructure entities Job (queue), AuditLogEntry,
WebhookEvent, ActivityEvent (per-lead timeline).

Common conventions: string ULID-ish ids, ISO-8601 timestamps, explicit
`status` state machines, `sourceProvenance` on leads/contacts, `traceId` on
every pipeline action.

## 5. Policy & approval system

`packages/core/src/policy/` implements named gates:

`SEND_FIRST_TOUCH`, `ACTIVATE_NEW_LEAD_SOURCE`, `ENABLE_SOCIAL_SOURCE`,
`SEND_PAYMENT_REQUEST`, `DEPLOY_PRODUCTION`, `UPDATE_LIVE_COPY`,
`CHANGE_COMPLIANCE_TEXT`, `ENABLE_FULL_AUTONOMY`.

- A gate evaluation needs: environment (`local | staging | production`),
  gate state (closed / open / autopilot), an `ApprovalRequest` (granted &
  unexpired) where required, and credential status of the executing adapter.
- `local` ⇒ dry-run forced, mocks preferred. `staging` ⇒ sandbox creds only.
  `production` ⇒ approved integrations only.
- Every evaluation (allow or deny) writes an audit log entry with rationale.
- `ENABLE_FULL_AUTONOMY` can only be flipped by the owner in Settings and
  never auto-enables; even then, per-gate overrides win.
- Workers call `policy.requireApproval(gate, context)` — there is no code path
  to a side-effecting adapter that bypasses the policy engine (adapters take a
  `PolicyTicket` issued only by the engine).

## 6. Pipelines (workflow jobs)

Each pipeline is a chain of idempotent jobs on the durable queue with retries,
backoff, and a shared `traceId`:

1. **Lead intake** — ingest (CSV/manual/API/places adapter) → normalize domain
   → dedupe (domain+email+company identity) → DNC/unsubscribe screen →
   provenance recorded → enqueue audit.
2. **Site audit** — robots.txt check → homepage + sitemap/nav pages →
   screenshots → Lighthouse → a11y scan → content/contact/social/CTA
   extraction → heuristic weaknesses → structured summary + score + outreach
   angles.
3. **Contact** — website-published contact data first → enrichment provider
   (when configured) → verification → persist confidence/provider/status.
4. **Outreach** — short, specific, niche-aware first-touch drafts; Cornell
   student mention; real audit findings; free already-built mockup offer;
   "Reply \"I'm not interested\" and you won't hear from me again" opt-out;
   approval-required send; Instantly handoff for approved leads; full
   send/open/reply/bounce/unsub tracking.
5. **Reply handling** — webhook/mailbox ingestion → intent classification →
   pause/stop follow-ups → immediate owner notification on positive intent →
   thread summary + recommended next step → opportunity record. Never
   schedules calls or follow-ups without notifying owner.
6. **Preview** — gather inputs (public info + clarifications) → template
   selection → preview generation → preview URL + screenshots + rationale →
   owner review first → revision loop.
7. **Deployment** — preview deploy → quality checks → approval token →
   production deploy → full history + rollback metadata.
8. **Billing** — Stripe payment-link/invoice drafts → policy-gated send →
   webhook completion → post-payment next steps.
9. **Scheduling** — notify owner to schedule via will@williamdamato.com;
   suggested times from calendar adapter free/busy.
10. **Reporting & memory** — daily memory summary; wins/failures/bottlenecks;
    daily + weekly owner reports; "what changed and why" log; experiment
    metrics by niche/template/variant/source.

## 7. API & dashboard

- API: bearer-token owner session (server-side validated on every request),
  RBAC roles (`owner`, `viewer`), helmet-style security headers, CSRF-safe
  (token auth, no cookie-form posts), rate limiting on public endpoints,
  webhook signature verification (Instantly HMAC, Stripe signatures) with
  raw-body capture, full audit logging of sensitive mutations.
- Dashboard pages: Overview, Leads, Audits, Outreach, Replies, Opportunities,
  Site Projects, Review Queue, Deployments, Billing, Calendar/Calls,
  Memory/Lessons, Experiments, Failures/Logs, Owner Requests, Integrations,
  Settings/Policies. Searchable/filterable tables, per-lead activity timeline,
  one-click approve/reject, side-by-side audit vs preview, visible confidence
  + rationale, automatic-vs-approved action history.

## 8. Observability

Structured JSON logs; per-workflow `traceId`; per-lead `ActivityEvent`
timeline; failure-reason taxonomy on `FailureLog`; retry counters on jobs;
webhook event history; metrics: reply rate, positive-reply rate, close rate,
bounce rate, unsubscribe rate, build time, revision count, deployment
failures.

## 9. Testing strategy

- Unit: policy engine (dangerous actions blocked without approval), scoring,
  dedupe, draft content rules, memory engine.
- Integration: adapters against mocks; repository round-trips.
- E2E (later phases): dashboard flows via Playwright; preview-site checks;
  Lighthouse + a11y automation.
- Seed/demo: `npm run demo` seeds realistic fake leads and runs the full
  dry-run pipeline so the system is explorable with zero credentials.

## 10. Bootstrapping phases

- **A (this milestone):** scaffold, schemas, dashboard shell, policy engine,
  memory engine, mock adapters, demo seed.
- **B:** Playwright audit pipeline + reports, lead scoring, truthful outreach
  drafts, review queue.
- **C:** Instantly adapter + webhooks, Gmail abstraction, Stripe drafts,
  Vercel previews.
- **D:** preview generation from starter kits, revision loop, production
  deploy approval flow.
- **E:** experiment engine, daily/weekly reporting, owner-request
  optimization, transcript/design-reference ingestion.

## 11. Known assumptions (encoded as config flags / TODOs)

- `WORKFLOW_ENGINE=sqlite-queue` — revisit Temporal/Inngest when volume grows.
- `AUDITOR_MODE=mock|playwright` — Playwright browsers must be installed
  (`npx playwright install chromium`) before `playwright` mode works.
- Enrichment/verification providers unchosen — adapter interface fixed,
  provider selection is an OwnerRequest.
- Higgsfield usage limits unconfirmed — adapter stays dry-run until owner
  confirms allowed usage.
