# William D'Amato — Project Standards

Agentic sales-and-delivery platform that wins website clients. Read
`docs/architecture.md` before structural changes.

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

### NEXT: Phase C (start here)

Goal: real adapters (instantly/gmail/stripe/vercel) behind the existing
interfaces in packages/integrations; select by credential presence.

### Then
- **Phase D** — React+Framer Motion full builds, revision loop, deploy
  approval flow (`TODO(phase-d)` in apps/api decide route: DEPLOY_PRODUCTION
  follow-through job).
- **Phase E** — experiment engine, weekly reports, transcript/design-reference
  ingestion (adapter interface exists, mock only).
