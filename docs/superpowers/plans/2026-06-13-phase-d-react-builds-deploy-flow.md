# Phase D — React Builds, Revision Loop, Deploy Approval Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.
> Compact plan (per owner's token-conservation rule); code lives in the diffs.

**Goal:** React+Framer Motion full builds (`STACK_MODE=react`), owner revision
loop on site projects, and the DEPLOY_PRODUCTION approval follow-through that
calls the (Phase C) Vercel adapter — plus `PREVIEW_QUALITY_THRESHOLDS`
promoted to config.

**Architecture:** Static single-file preview stays the owner-review/quality
artifact (no npm needed). `STACK_MODE=react` additionally emits a Vite+React+
Framer Motion project to `data/builds/<leadId>/`; deploys prefer `buildPath`.
Revisions are structured overrides merged into `companyData` then re-rendered.
Production deploys ride the existing gate machinery: request-deploy route →
`requestApproval(DEPLOY_PRODUCTION)` → owner grants → decide route enqueues
`deploy.production` → handler `evaluateGate` → vercel adapter (dry-run in
local, always).

**Tech stack:** existing monorepo; generated artifact uses Vite 5 + React 18 +
framer-motion 11 (customer project, built by Vercel — not a workspace dep).

---

- [x] **Task 1 — Config flags** (`packages/core/src/env.ts`, new
  `packages/core/test/env.test.ts`): add `stackMode: "static" | "react"`
  (`STACK_MODE`, default static) and `previewQuality: { minPerformance,
  minAccessibility }` (`PREVIEW_MIN_PERFORMANCE`/`PREVIEW_MIN_ACCESSIBILITY`,
  defaults 70/80, NaN-safe). Tests: defaults, react mode, custom thresholds,
  local dry-run still forced.
- [x] **Task 2 — Schema**: `SiteProject` + `stack` enum (default static) +
  `buildPath` nullable; `SiteRevision` + `overrides` record (default {}).
  zod defaults keep existing rows valid.
- [x] **Task 3 — React renderer** (`packages/templates/src/renderReact.ts`,
  test `packages/templates/test/renderReact.test.ts`): `renderReactProject
  (template, data): { file, data }[]` → package.json (react/react-dom/
  framer-motion/vite/@vitejs/plugin-react), vite.config.ts, index.html,
  src/main.tsx, src/App.tsx (sections mirror static preview; `motion` +
  `useReducedMotion`), src/styles.css (theme vars). Company data embedded
  via JSON.stringify (no template-literal injection). Export from index +
  `getTemplateById` in registry.
- [x] **Task 4 — site-builder** (`workers/site-builder/src/build.ts`):
  `BuildInput.stackMode?`; react mode writes the project to
  `data/builds/<leadId>/` and sets `stack`/`buildPath`. New
  `applyRevisionOverrides(project, overrides, dataDir)` — whitelist
  REVISABLE_FIELDS, merge into companyData, re-render preview (+ react build
  if stack react), return `{ project, applied }`.
- [x] **Task 5 — thresholds param** (`workers/site-auditor/src/
  playwright-audit.ts`): `qualityCheckPreview` gains `thresholds?` defaulting
  to `PREVIEW_QUALITY_THRESHOLDS`; orchestrator passes
  `ctx.config.previewQuality`; remove the TODO(phase-d) comment.
- [x] **Task 6 — Vercel multi-file deploy**
  (`packages/integrations/src/real/vercel.ts` + real-adapters test):
  directory sources upload ALL files recursively (skip node_modules/.git/
  dist, cap 200 files), posix-relative paths; add
  `projectSettings: { framework: "vite" }` when package.json present
  (TODO(phase-e) verify against docs with a live token). Test: dir with
  index.html + src/App.tsx + package.json → 3 files + framework set.
- [x] **Task 7 — Orchestrator** (`workers/orchestrator/src/pipelines.ts`):
  (a) preview build passes stackMode + thresholds; after quality check, if
  vercel credential present, preview-deploy via `operationalTicket` →
  DeploymentRecord(target preview) + previewUrl. (b) `site.revise` handler:
  apply overrides → re-quality-check → revision applied / rejected-with-note
  when nothing recognizable (blocked ≠ stuck: activity says what to send).
  (c) `deploy.production` handler: re-check quality gate (defense in depth),
  `evaluateGate(DEPLOY_PRODUCTION)` → vercel.deploy(target production,
  buildPath ?? preview dir) → DeploymentRecord dry_run/deployed/failed,
  project status approved_for_customer/live, failures via
  `memory.recordFailure`.
- [x] **Task 8 — API** (`apps/api/src/server.ts` + server.test.ts):
  `POST /api/site-projects/:id/revisions` (request text required; overrides
  sanitized) → SiteRevision + `site.revise` job; `POST /api/site-projects/
  :id/request-deploy` → 409 if no preview or failed quality, else
  `requestApproval(DEPLOY_PRODUCTION)` + status approved_for_customer;
  decide route: granted DEPLOY_PRODUCTION → enqueue `deploy.production`.
  Tests: revision applies override; request-deploy + grant → deployment
  record exists (dry_run) and project live-path never fires in local;
  deploy.production without approval → policy_denied failure.
- [x] **Task 9 — Dashboard** (`apps/dashboard/src/pages/LeadDetail.tsx`):
  revision form (request + common override fields), "Request production
  deploy" button (disabled w/ reason when quality failed), deployments list
  with status/url badges.
- [x] **Task 10 — Verify + ship**: compliance-reviewer subagent on the
  deploy-gating + webhook-adjacent diff (mandatory), `npm test`,
  `npm run typecheck`, `npm run demo`, commit + push, update CLAUDE.md
  status + memory.
