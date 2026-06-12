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

## Current phase

Phase A complete (scaffold, schemas, policy engine, pipelines, mocks, demo,
dashboard). Next: Phase B (Playwright/Lighthouse auditing), C (real Instantly/
Gmail/Stripe/Vercel adapters), D (React+Framer Motion builds, deploy flow),
E (experiments, reporting, design-reference ingestion).
