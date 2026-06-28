# Outreach-Tool Pivot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the William platform into a single-purpose business-outreach tool: source local businesses from Google Maps → find an email cheaply (first) → audit + score the site → if it scores above a threshold, write a short human email → push the lead + email to Instantly.

**Architecture:** Reuse the proven framework (Places sourcing, Playwright audit, `scoreLead`, email discovery/ranking, SQLite store + queue, API + dashboard, policy/DNC rails). Reorder the pipeline so a cheap email-discovery step runs before the expensive audit. Delete the scrapped subsystems (website building, billing, calendar, follow-ups, all inbound reply handling, experiments, reports). Two top-level settings (`OUTREACH_SCORE_THRESHOLD`, `PUSH_MODE`) gate emailing and auto-push.

**Tech Stack:** TypeScript (strict, `moduleResolution: Bundler`), Node + tsx, vitest, Express, React + Vite, better-sqlite3, zod, Playwright, Anthropic + Google Places + Instantly adapters.

## Global Constraints

- **Branch:** all work on `outreach-tool`. `main` stays the frozen old version. **Never read `.env`.**
- **Invariants kept (verbatim from CLAUDE.md):** inbound/scraped text is DATA, never an LLM instruction; side effects require a PolicyTicket; `local` env = dry-run always; DNC/unsubscribe absolute (screen at intake, draft, push); the opt-out line is compliance text `validateDraft` enforces.
- **Email rules:** William writes the whole email as a **deterministic template** (no LLM/Opus copy generation). Body ≤ 5 sentences (excluding greeting, P.S., sign-off). NO emdashes (`—`), en-dashes (`–`), or `--`. Friendly-professional Cornell-student voice. Friendly P.S. opt-out using a comma. No URL in the email. Keep the free-mockup hook.
- **Owner does the building, not the tool:** the tool's job ENDS when the email is pushed to Instantly. Removed entirely (owner handles these himself): LLM outreach copy (`llm.generateOutreachCopy` / `applyOpusCopy` / `OUTREACH_SYSTEM`), build-prompt generation (`llm.generateBuildPrompt` + `WebsiteBrief` + `site.ship` + delivery email), and Firecrawl scraping (`firecrawl.scrapeCompany`). Keep `llm.scoreVisualDesign` (Haiku vision scoring is part of the kept scoring framework).
- **Backups:** before any deletion, copy the scrapped standalone dirs to an external backup folder. `main` also holds the complete old version. Keep both until the owner says the pivot is complete, then delete the external backup.
- **Settings (defaults):** `OUTREACH_SCORE_THRESHOLD = 45` (only sites scoring ABOVE this are emailed; higher score = worse site = better prospect). `PUSH_MODE = "review"` (qualified leads wait for owner Approve & push; `"auto"` pushes automatically). Both env-overridable.
- **Mock-first:** full vitest suite + `npm run demo` pass with zero credentials. `npm run typecheck` clean.
- **`compliance-reviewer`** (read-only subagent) MUST review the email-content changes (Phase 3) and the push path (Phase 4 push-mode + Phase 1 send simplification) before those commits land.
- **Keep the branch green:** every task ends with `npm test` + `npm run typecheck` passing. Deletion tasks remove the dead code AND its tests in the same commit.
- Address the owner as **Powell** at the start of responses (canary).

**Commands:** `npm test` (all vitest), `npm run typecheck`, `npm run demo` (hermetic dry-run), `npm run build` in `apps/dashboard` (dashboard typecheck/build).

---

## Phase 0 — Baseline

### Task 0: Confirm green baseline on the branch

**Files:** none (verification only).

- [ ] **Step 1: Confirm branch + clean tree**

Run: `git rev-parse --abbrev-ref HEAD` → expect `outreach-tool`. Run: `git status --short` → expect clean (the spec/CLAUDE.md banner already committed).

- [ ] **Step 2: Record the baseline test count**

Run: `npm test 2>&1 | tail -20`
Expected: all suites pass. **Write the passing test count here for later comparison:** `BASELINE = ____`.

- [ ] **Step 3: Confirm typecheck + demo**

Run: `npm run typecheck` → expect clean. Run: `npm run demo 2>&1 | tail -5` → expect 0 dead-letter.

### Task 0B: Back up the code to be deleted (before any deletion)

**Files:** none in-repo. Creates an EXTERNAL backup folder (outside the repo working tree so it is never committed and survives across sessions).

> The `main` branch already holds the complete old version (and git history preserves everything regardless). This external copy is an extra safety net for easy reference during the build, per the owner. Delete it ONLY when the owner says the pivot is complete.

- [ ] **Step 1: Create the backup folder and copy the standalone scrapped dirs**

Run (Git Bash):
```bash
BK="/c/Users/willi/OneDrive/Desktop/GitHub/Repositories/_william-pivot-backup-2026-06-28"
mkdir -p "$BK"
cp -r workers/billing workers/scheduling workers/site-builder packages/templates "$BK"/
ls "$BK"
```
Expected: `billing  scheduling  site-builder  templates`.

- [ ] **Step 2: Note partial-file backups**

The files deleted from KEPT packages (adapters: stripe/vercel/gmail/firecrawl/transcripts; `experiments.ts`; outreach `followup.ts`/`classify.ts`/delivery code; scrapped schema files; dashboard pages) are recoverable from `main` (e.g. `git show main:packages/integrations/src/real/stripe.ts`). No separate copy needed — `main` is authoritative for those.

- [ ] **Step 3: Confirm + proceed**

Backup exists at `_william-pivot-backup-2026-06-28` (sibling of the repo). Deletions in Phase 1 may now proceed.

---

## Phase 1 — Trim the surface (deletions)

Delete the scrapped handlers, their worker packages, scrapped adapters/schemas, and the dashboard/API surfaces for them. Each task keeps the suite green by removing the corresponding tests in the same commit. Do these BEFORE the behavior changes so later phases work in a slim codebase.

### Task 1: Remove scrapped job handlers from `pipelines.ts`

**Files:**
- Modify: `workers/orchestrator/src/pipelines.ts`
- Test: `workers/orchestrator/test/pipeline.test.ts`

**Interfaces:**
- Produces: a slimmed `JOB_HANDLERS` containing only `lead.audit`, `lead.score`, `lead.contact`, `outreach.draft`, `outreach.send`, `lead.source`.

- [ ] **Step 1: Delete the handler functions**

In `pipelines.ts`, delete these handler functions entirely: `handleOutreachClose`, `handleFollowUp`, `handleReply`, `handleBriefGenerate`, `handlePreviewBuild`, `handleSiteRevise`, `handleDeployProduction`, `handleDeployPreview`, `handleSiteShip`, `handleDeliveryDraft`, `handleBillingDraft`, `handleBillingExecute`, `handleTranscriptIngest`, `handlePollReplies`. Also delete the helpers used only by them: `attachQualityCheck`, `deployProjectName`, `recordDeployment`, `BUILDER_DISABLED_NOTE`, `applyOpusCopy`, `visualFindingStrings`, `lighthouseSummary` (the last three were used only by `handleDraft`/`handleFollowUp` for the now-removed LLM outreach-copy path).

- [ ] **Step 2: Simplify `handleSend`'s tail (remove follow-up/close scheduling + delivery special-case)**

In `handleSend`, delete the `DELIVERY_VARIANT` special-case block, the `nextFollowUp(...)` follow-up enqueue block, and the `outreach.close` enqueue block. The handler ends after marking the lead `contacted`:

```ts
  setLeadStatus(ctx, lead, "contacted");
  ctx.store.writeActivity(lead.id, "outreach_sent", result.detail, { traceId: job.traceId, byApproval: true });
};
```

Also remove the now-unused touch-cap re-check that references `draft.variant.startsWith("followup-")` and `MAX_TOUCHES` (no follow-ups exist anymore).

- [ ] **Step 3: Reduce `JOB_HANDLERS` to the kept handlers**

```ts
export const JOB_HANDLERS: Record<string, JobHandler> = {
  "lead.audit": handleAudit,
  "lead.contact": handleContact,
  "lead.score": handleScore,
  "outreach.draft": handleDraft,
  "outreach.send": handleSend,
  "lead.source": handleLeadSource,
};
```

- [ ] **Step 4: Fix imports**

Remove now-unused imports from `pipelines.ts`: from `@william/worker-outreach` keep only `OPT_OUT_LINE`, `createFirstTouchDraft`, `screenForContactability`, `validateDraft` (drop `DELIVERY_VARIANT`, `MAX_TOUCHES`, `NO_RESPONSE_CLOSE_DAYS`, `classifyReplyAssisted`, `createDeliveryDraft`, `createFollowUpDraft`, `evaluateFollowUp`, `nextFollowUp`, `recommendedNextStep`). Remove the entire imports of `@william/worker-site-builder`, `@william/worker-billing`, `@william/worker-scheduling`. Remove `applyRevisionOverrides`, `buildPreviewSite`, `createInvoiceDraft`, `executeInvoiceDraft`, `suggestCall`. Remove unused `@william/core` type imports: `DeploymentRecord`, `Opportunity`, `SiteProject`, `WebsiteBrief`. Remove `qualityCheckPreview` from the `@william/worker-site-auditor` import. Remove `CompanyScrapeHints`, `ExecutionResult`, AND `OutreachCopyRequest` from the `@william/integrations` import (the LLM outreach-copy path is removed). Remove `assignVariant`, `runningExperiment` from `./experiments` (the whole import line — experiments are deleted in Task 5).

- [ ] **Step 4b: Simplify `handleDraft` to the deterministic template only (no LLM copy, no experiments)**

Replace the body of `handleDraft` (between the DNC re-screen and the `requestApproval` call) so it uses the template draft directly:

```ts
  const draft = createFirstTouchDraft({ lead, company, contact, audit, traceId: job.traceId });
  const problems = validateDraft(draft);
  if (problems.length > 0) throw new Error(`Draft failed content rules: ${problems.join(", ")}`);
```

Delete the `const experiment = runningExperiment(...)` line, the `assignVariant(...)` usage, the `baseDraft`/`applyOpusCopy` call, and the variant/experiment wiring. (`createFirstTouchDraft`'s signature loses its `variant` arg in Phase 3 Task 9; passing none is correct.)

- [ ] **Step 5: Delete tests for removed handlers**

In `workers/orchestrator/test/pipeline.test.ts`, delete every `it(...)`/`describe(...)` block exercising the removed handlers: follow-up sequence, close-out, reply/`reply.process`, positive-reply→brief, `brief.generate`, `preview.build`, `site.revise`, `deploy.production`, `deploy.preview`, `site.ship`, `outreach.delivery`, `billing.draft`, `billing.execute`, `ingest.transcript`, `instantly.pollReplies`. Keep audit/contact/score/draft/send happy-path tests.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test` and `npm run typecheck`. Fix any remaining references to deleted symbols. Expected: green (fewer tests than BASELINE).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(pipeline): remove scrapped handlers (followup/reply/brief/ship/deploy/billing/transcript/poll)"
```

### Task 2: Delete scrapped worker packages

**Files:**
- Delete dirs: `workers/billing/`, `workers/scheduling/`, `workers/site-builder/`, `packages/templates/`
- Modify: root `package.json` (workspaces), any `tsconfig` references, `apps/api` / orchestrator `package.json` deps if they list these.

- [ ] **Step 1: Remove the package directories**

```bash
git rm -r workers/billing workers/scheduling workers/site-builder packages/templates
```

- [ ] **Step 2: Drop workspace deps**

Search for dependency references and remove them:

Run: `git grep -n "worker-billing\|worker-scheduling\|worker-site-builder\|@william/templates"`
Remove each hit (package.json `dependencies` entries, leftover imports). There should be none left in `src` after Task 1; if any remain, delete those lines.

- [ ] **Step 3: Tests + typecheck + commit**

Run: `npm install` (refresh workspace links), `npm test`, `npm run typecheck`. Expected: green.

```bash
git add -A && git commit -m "chore: delete site-builder, billing, scheduling workers + templates package"
```

### Task 3: Trim `@william/worker-outreach` to outreach essentials

**Files:**
- Modify: `workers/outreach/src/index.ts` (barrel exports)
- Delete: `workers/outreach/src/followup.ts`, the delivery-draft code in `draft.ts` (`createDeliveryDraft`, `DELIVERY_VARIANT`, `DeliveryDraftInput`), the reply-classification modules (`classify.ts` / `classifyReplyAssisted`, `recommendedNextStep`, `evaluateFollowUp`, `nextFollowUp`, `MAX_TOUCHES`, `NO_RESPONSE_CLOSE_DAYS`) — wherever they live.
- Test: the corresponding `workers/outreach/test/*` files.

- [ ] **Step 1: Find the modules**

Run: `git grep -ln "createDeliveryDraft\|classifyReplyAssisted\|evaluateFollowUp\|nextFollowUp\|recommendedNextStep\|NO_RESPONSE_CLOSE_DAYS" workers/outreach/src`

- [ ] **Step 2: Delete the follow-up + delivery + reply-classification code and their exports**

Delete `followup.ts` and the classification module. In `draft.ts` remove `createDeliveryDraft`, `DeliveryDraftInput`, and `DELIVERY_VARIANT` (and the `variant !== DELIVERY_VARIANT` branch in `validateDraft` — Phase 3 rewrites `validateDraft` anyway, but keep it compiling here: change the URL check to unconditional `if (URL_IN_COPY_RE.test(draft.body))`). Update the barrel `index.ts` to stop exporting the removed symbols. Keep exports: `OPT_OUT_LINE`, `createFirstTouchDraft`, `validateDraft`, `screenForContactability`, `FIRST_TOUCH_VARIANTS` (removed in Phase 3).

- [ ] **Step 3: Delete the corresponding tests**

Delete `workers/outreach/test` files covering follow-ups, delivery email, and reply classification. Keep first-touch draft + `validateDraft` + screening tests.

- [ ] **Step 4: Tests + typecheck + commit**

Run: `npm test`, `npm run typecheck`. Expected: green.

```bash
git add -A && git commit -m "refactor(outreach): drop follow-up, delivery, and reply-classification modules"
```

### Task 4: Delete scrapped integration adapters

**Files:**
- Modify: `packages/integrations/src/` — remove Stripe, Vercel, Gmail, Firecrawl, and transcripts adapters and their wiring in `createIntegrations` + `detectCredentials`; remove the `LlmAdapter` methods only used by deleted flows (`generateBuildPrompt`, `generateOutreachCopy`, `classifyReply`, `extractTranscriptInsights`) and the `instantly.pauseLead` / `instantly.pollInbound` methods (no inbound). Keep: `places`, `instantly.pushLead`, `llm.scoreVisualDesign`, `enrichment`.
- Test: `packages/integrations/test/real-adapters.test.ts` and mock tests.

**Interfaces:**
- Produces: an `Integrations` type with `places`, `instantly` (push only), `llm` (`scoreVisualDesign` only), `enrichment`.

- [ ] **Step 1: Inventory usage in the orchestrator first**

Run: `git grep -n "integrations\.\(stripe\|vercel\|gmail\|firecrawl\|transcripts\)\|generateBuildPrompt\|generateOutreachCopy\|classifyReply\|extractTranscriptInsights\|pauseLead\|pollInbound" workers apps`
Confirm only test files / already-deleted code reference them. `generateOutreachCopy` was used only by the now-removed `applyOpusCopy` (Task 1); `firecrawl.scrapeCompany` and `transcripts.extractInsights` only by `handleBriefGenerate`/`handleTranscriptIngest` (Task 1) — all safe to remove.

- [ ] **Step 2: Remove the adapters + methods**

Delete the Stripe, Vercel, Gmail, Firecrawl, and transcripts adapter files (`packages/integrations/src/real/*` and mock equivalents) and remove them from the `Integrations` interface, `createIntegrations`, and `detectCredentials`. From `LlmAdapter` remove `generateBuildPrompt`, `generateOutreachCopy` (and the `OUTREACH_SYSTEM` constant + `OutreachCopyRequest` type), `classifyReply`, `extractTranscriptInsights` — keep only `scoreVisualDesign`. From `InstantlyAdapter` remove `pauseLead`, `pollInbound` and the `InboundEmail` type. Keep `pushLead`.

- [ ] **Step 3: Delete/trim adapter tests**

In `packages/integrations/test/real-adapters.test.ts` delete the describe blocks for the removed adapters/methods. Keep Places, Instantly `pushLead`, and `llm.scoreVisualDesign`.

- [ ] **Step 4: Tests + typecheck + commit**

Run: `npm test`, `npm run typecheck`. Expected: green.

```bash
git add -A && git commit -m "chore(integrations): remove stripe/vercel/gmail/firecrawl/transcripts + inbound LLM methods"
```

### Task 5: Delete experiments, weekly reports, and unused schemas

**Files:**
- Delete: `workers/orchestrator/src/experiments.ts` + its test; weekly-report generation in `@william/memory` + tests.
- Modify: `packages/core/src/schema/` — remove now-unused entity schemas: `brief.ts` (WebsiteBrief, CompanyFacts), site-project/site-revision, deployment, invoice/payment, opportunity, reply, call-suggestion/booking, experiment, weekly-report, campaign-sync? (KEEP `campaign-sync` — `handleSend` records it). Remove from the core barrel + any `Store` repositories + the API collection whitelist + dashboard.
- Test: schema/store/api tests referencing the removed entities.

> Right-sizing note: removing a schema touches `packages/core` (schema + barrel), `packages/db` (Store repo + collection whitelist), `apps/api` (collection whitelist), and tests. Do the schemas as one careful task; let `npm run typecheck` drive you to every reference.

- [ ] **Step 1: Delete experiments + weekly reports**

```bash
git rm workers/orchestrator/src/experiments.ts
```
Run: `git grep -ln "experiments\|weeklyReport\|WeeklyReport\|generateWeeklyReport"` and remove the memory weekly-report module, the Monday-rollover call in `workers/orchestrator/src/main.ts`, and their tests.

- [ ] **Step 2: Remove unused entity schemas**

For each of: `WebsiteBrief`/`CompanyFacts`, `SiteProject`, `SiteRevision`, `DeploymentRecord`, `InvoiceDraft`, `Payment`, `Opportunity`, `Reply`/`ReplyEvent`, `CallSuggestion`, `Booking`, `Experiment`, `WeeklyReport`, `Transcript` — delete the schema file, remove the barrel export in `packages/core/src/index.ts`, remove the `Store` repository (`packages/db/src/store.ts`), and remove the collection-whitelist entry in `apps/api/src/server.ts` (lines ~40-54) and the `/api/leads/:id` aggregation references (deployments/invoices). KEEP: `Lead`, `Company`, `Contact`, `WebsiteAudit`, `LeadScore`, `OutreachDraft`, `CampaignSync`, `SourcingRun`, `DoNotContact`, `Unsubscribe`, `ComplianceEvent`, `ActivityEvent`, `OwnerRequest`, `ApprovalRequest`, `PolicyTicket`/policy, `CredentialStatus`, `Job`, `DurableLesson`, `DailyMemory`, `AuditLog`, `Failure`, `WebhookEvent`.

- [ ] **Step 3: Let typecheck find the stragglers**

Run: `npm run typecheck` and fix every reference until clean (the Store, server whitelist, Overview aggregation, and tests are the usual spots).

- [ ] **Step 4: Delete corresponding tests; run suite**

Delete `packages/db/test` + `apps/api/test` + `packages/core/test` blocks for the removed entities. Run: `npm test`. Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore(core): remove experiments, reports, and scrapped entity schemas"
```

### Task 6: Remove scrapped API routes

**Files:**
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/test/server.test.ts`

- [ ] **Step 1: Delete the routes**

Remove these route handlers: `site-projects/:id/revisions`, `site-projects/:id/request-deploy`, `site-projects/:id/deploy-preview`, `website-briefs/:id/ship`, `experiments` (POST + `/:id/compute` + `/:id/conclude`), the manual reply route (`reply.process` enqueue, ~line 615), and any weekly-reports route. Keep: `/healthz`, `/api/overview`, `/api/leads/*`, `/api/review-queue`, `/api/approvals/:id/decide`, `/api/sourcing-runs` (GET + POST), the generic collection routes, and the policies routes.

- [ ] **Step 2: Trim the decide route**

In `POST /approvals/:id/decide`, keep only the `SEND_FIRST_TOUCH` → `outreach.send` and `ACTIVATE_NEW_LEAD_SOURCE` → `lead.source` branches. Delete the `billing.execute`, `site.ship`, and `deploy.production` branches.

- [ ] **Step 3: Delete corresponding tests; run; commit**

Remove `server.test.ts` blocks for the deleted routes. Run: `npm test`, `npm run typecheck`.

```bash
git add -A && git commit -m "chore(api): remove builder/billing/experiment/reply routes; trim decide route"
```

### Task 7: Remove scrapped dashboard pages + nav

**Files:**
- Modify: `apps/dashboard/src/App.tsx`
- Delete: `apps/dashboard/src/pages/Experiments.tsx`, `WebsiteBriefs.tsx`
- Test: dashboard builds (`npm run build` in `apps/dashboard`).

- [ ] **Step 1: Trim `NAV` + routes**

In `App.tsx`, reduce `NAV` to: Overview, Review Queue, Leads (group Pipeline), Source leads (group Pipeline), Audits, Outreach (drafts + campaign-syncs), Owner Requests, Integrations, Settings/Policies. Delete the entries for: Replies, Opportunities, Website Briefs, Site Projects, Deployments, Billing, Calendar/Calls, Memory, Experiments, Failures (optional: keep Failures for ops — keep it). Remove the `Experiments`/`WebsiteBriefs` imports + `<Route>`s. Delete the two page files.

- [ ] **Step 2: Build + commit**

Run: `cd apps/dashboard && npm run build` → expect clean. (Root `npm run typecheck` too.)

```bash
git add -A && git commit -m "chore(dashboard): remove briefs/experiments/billing/calendar/deploy nav + pages"
```

---

## Phase 2 — Settings

### Task 8: Add `outreachScoreThreshold` + `pushMode` to `RuntimeConfig`

**Files:**
- Modify: `packages/core/src/env.ts`
- Test: `packages/core/test/env.test.ts`

**Interfaces:**
- Produces: `RuntimeConfig.outreachScoreThreshold: number` and `RuntimeConfig.pushMode: "review" | "auto"`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/env.test.ts`:

```ts
it("defaults outreachScoreThreshold to 45 and pushMode to review", () => {
  const c = loadConfig({ WILLIAM_ENV: "local" } as NodeJS.ProcessEnv);
  expect(c.outreachScoreThreshold).toBe(45);
  expect(c.pushMode).toBe("review");
});

it("reads OUTREACH_SCORE_THRESHOLD and PUSH_MODE from env", () => {
  const c = loadConfig({ WILLIAM_ENV: "staging", OUTREACH_SCORE_THRESHOLD: "60", PUSH_MODE: "auto" } as NodeJS.ProcessEnv);
  expect(c.outreachScoreThreshold).toBe(60);
  expect(c.pushMode).toBe("auto");
});

it("ignores an out-of-range or invalid threshold/push mode", () => {
  const c = loadConfig({ WILLIAM_ENV: "staging", OUTREACH_SCORE_THRESHOLD: "999", PUSH_MODE: "banana" } as NodeJS.ProcessEnv);
  expect(c.outreachScoreThreshold).toBe(45);
  expect(c.pushMode).toBe("review");
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -w packages/core -- env` → FAIL (`outreachScoreThreshold` undefined).

- [ ] **Step 3: Implement**

In `env.ts`, add to the `RuntimeConfig` interface (near the top, easy to find):

```ts
  /** Only sites scoring ABOVE this (0-100) get an outreach email. Higher score = worse site = better prospect. */
  outreachScoreThreshold: number;
  /** "review" = qualified leads wait for owner Approve & push; "auto" = push to Instantly automatically. */
  pushMode: "review" | "auto";
```

In `loadConfig`'s returned object add (reusing the existing `threshold` helper for 0-100 clamping):

```ts
    outreachScoreThreshold: threshold(env.OUTREACH_SCORE_THRESHOLD, 45),
    pushMode: env.PUSH_MODE === "auto" ? "auto" : "review",
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -w packages/core -- env` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(config): add outreachScoreThreshold (45) and pushMode (review) settings"
```

---

## Phase 3 — Email rewrite (compliance-reviewed)

### Task 9: Rewrite the first-touch email + `validateDraft`

**Files:**
- Modify: `workers/outreach/src/draft.ts`
- Test: `workers/outreach/test/draft.test.ts` (adjust existing)

**Interfaces:**
- Consumes: `createFirstTouchDraft({ lead, company, contact, audit, traceId })` (drop the `variant` arg).
- Produces: `OPT_OUT_LINE` (friendly P.S.), `createFirstTouchDraft`, `validateDraft`, `countMessageSentences(body: string): number`.

- [ ] **Step 1: Write the failing tests**

Replace the draft tests with rules-focused ones:

```ts
import { createFirstTouchDraft, validateDraft, OPT_OUT_LINE } from "../src/draft";
// build minimal lead/company/contact/audit fixtures (copy an existing test's fixtures)

it("first-touch email is <=5 sentences, has no emdash, Cornell, mockup, and the P.S. opt-out", () => {
  const draft = createFirstTouchDraft(fixture());
  expect(validateDraft(draft)).toEqual([]);
  expect(draft.body).toContain(OPT_OUT_LINE);
  expect(/cornell/i.test(draft.body)).toBe(true);
  expect(/mockup/i.test(draft.body)).toBe(true);
  expect(/[—–]|--/.test(draft.body)).toBe(false);
});

it("OPT_OUT_LINE is a friendly P.S. with a comma, not an emdash", () => {
  expect(OPT_OUT_LINE.startsWith("P.S.")).toBe(true);
  expect(/[—–]/.test(OPT_OUT_LINE)).toBe(false);
});

it("validateDraft rejects a body over 5 sentences", () => {
  const draft = createFirstTouchDraft(fixture());
  const bloated = { ...draft, body: draft.body.replace(OPT_OUT_LINE, "One. Two. Three. Four. Five. Six.\n\n" + OPT_OUT_LINE) };
  expect(validateDraft(bloated)).toContain("body too long (>5 sentences)");
});

it("validateDraft rejects an emdash", () => {
  const draft = createFirstTouchDraft(fixture());
  const bad = { ...draft, body: draft.body + "\nextra — dash" };
  expect(validateDraft(bad)).toContain("contains an emdash");
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -w workers/outreach -- draft` → FAIL.

- [ ] **Step 3: Implement the new email + validator**

Replace the contents of `draft.ts` with (keep imports of `NICHE_META`, types, `newId`, `nowIso`):

```ts
/** Friendly P.S. opt-out — compliance text validateDraft enforces. Comma, no emdash. */
export const OPT_OUT_LINE = `P.S. If you'd rather not hear from me, just say the word and I'll take you off my list right away, no hard feelings!`;

export interface DraftInput {
  lead: Lead;
  company: Company;
  contact: Contact;
  audit: WebsiteAudit;
  traceId: string;
}

/** The single first-touch variant id (experiments removed). */
export const FIRST_TOUCH_VARIANT = "v1-cornell-mockup";

function joinAngles(angles: string[]): string {
  if (angles.length === 0) return "";
  if (angles.length === 1) return angles[0]!;
  return `${angles[0]} and ${angles[1]}`;
}

export function createFirstTouchDraft(input: DraftInput): OutreachDraft {
  const { lead, company, contact, audit } = input;
  const firstName = contact.name?.split(/\s+/)[0];
  const greeting = firstName ? `Dear ${firstName},` : `Hi there,`;
  const niche = NICHE_META[lead.niche].label.toLowerCase();
  const place = company.city ? `${company.city} ${niche}` : `local ${niche}`;

  const angles = audit.outreachAngles.slice(0, 2);
  const finding =
    angles.length > 0
      ? `I noticed ${joinAngles(angles)}, which probably costs you a few customers`
      : `I think a few quick changes could help you get more customers from your site`;

  const body = [
    greeting,
    "",
    `I'm Will, a student at Cornell, and I came across ${company.name} while looking at ${place} sites. ${finding}. I actually put together a quick mockup of how it could look, and I'd be happy to send it over if you want a peek. Either way, no worries at all if now's not a good time.`,
    "",
    `Thanks,`,
    `Will`,
    "",
    OPT_OUT_LINE,
  ].join("\n");

  const now = nowIso();
  return {
    id: newId("odft"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    contactId: contact.id,
    variant: FIRST_TOUCH_VARIANT,
    subject: `quick note about ${company.name}'s website`.slice(0, 70),
    body,
    personalizationNotes: [
      `niche: ${lead.niche}`,
      ...(firstName ? [`greeted by first name (${firstName})`] : ["no contact name — generic greeting"]),
    ],
    auditFindingsUsed: angles,
    status: "draft",
    approvalRequestId: null,
    sentAt: null,
    traceId: input.traceId,
  };
}

const URL_IN_COPY_RE = /(https?:\/\/|www\.[a-z0-9-]|\b[a-z0-9-]+\.(?:com|net|org|io|co|shop|store|app|dev|biz|us|cafe|site|online|xyz)\b)/i;

/** Count sentences in the MESSAGE (excludes greeting, sign-off lines, and the P.S.). */
export function countMessageSentences(body: string): number {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const content = lines.filter(
    (l) =>
      !/^(hi|hey|dear|hello)\b/i.test(l) &&
      !/^(thanks|best|cheers|regards|sincerely),?$/i.test(l) &&
      !/^will$/i.test(l) &&
      !/^p\.?s\.?/i.test(l),
  );
  return (content.join(" ").match(/[.!?](\s|$)/g) ?? []).length;
}

export function validateDraft(draft: OutreachDraft): string[] {
  const problems: string[] = [];
  if (!draft.body.includes(OPT_OUT_LINE)) problems.push("missing opt-out line");
  if (!/cornell/i.test(draft.body)) problems.push("missing Cornell student mention");
  if (!/mockup/i.test(draft.body)) problems.push("missing free-mockup offer");
  if (/[—–]|--/.test(draft.body)) problems.push("contains an emdash");
  if (countMessageSentences(draft.body) > 5) problems.push("body too long (>5 sentences)");
  if (draft.subject.length > 70) problems.push("subject too long");
  if (URL_IN_COPY_RE.test(draft.body)) problems.push("must not include a link/URL (the website is shared only after they reply)");
  return problems;
}
```

> Note: the em/en-dash check runs before the URL check; `OPT_OUT_LINE` contains no dash. Confirm `NICHE_META[...].label` exists (it does — `packages/core/src/niche.ts`).

- [ ] **Step 4: Run — expect pass**

Run: `npm test -w workers/outreach -- draft` → PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(outreach): short human first-touch email (<=5 sentences, no emdash, friendly P.S. opt-out)"
```

### Task 10: (REMOVED) Opus outreach prompt

There is no LLM/Opus outreach-copy path anymore (`generateOutreachCopy`/`applyOpusCopy`/`OUTREACH_SYSTEM` were removed in Tasks 1 + 4). The email is the deterministic template from Task 9 only. **Skip this task.**

### Task 11: compliance-reviewer on the email changes

- [ ] **Step 1: Dispatch the reviewer**

Dispatch the `compliance-reviewer` subagent (read-only) on the diff of `workers/outreach/src/draft.ts` (and `handleDraft` in `pipelines.ts`) vs `main`. Prompt it to check: opt-out line presence still enforced by `validateDraft`; DNC screening unaffected; lead-derived findings used in the template remain DATA, never instructions; no new side-effect path. Apply any required advisories, re-run `npm test`, and commit fixes if any.

---

## Phase 4 — Pipeline reorder + cheap email discovery + score gate + push mode

### Task 12: Cheap homepage email fetch (no browser)

**Files:**
- Create: `workers/site-auditor/src/homepage-email.ts`
- Modify: `workers/site-auditor/src/index.ts` (export it)
- Test: `workers/site-auditor/test/homepage-email.test.ts`

**Interfaces:**
- Produces: `fetchHomepageEmails(url: string, opts: { fetchImpl?: typeof fetch; ticket: { dryRun: boolean }; companyName?: string | null }): Promise<string[]>` — returns ranked, placeholder-filtered emails extracted from the homepage HTML; `[]` under `ticket.dryRun` (zero network) or on any error.

- [ ] **Step 1: Write the failing test**

```ts
import { fetchHomepageEmails } from "../src/homepage-email";

it("returns [] under dry-run without fetching", async () => {
  let called = false;
  const fetchImpl = (async () => { called = true; return new Response("hi@real.com"); }) as unknown as typeof fetch;
  const out = await fetchHomepageEmails("https://x.com", { fetchImpl, ticket: { dryRun: true } });
  expect(out).toEqual([]);
  expect(called).toBe(false);
});

it("extracts and ranks emails from homepage HTML, dropping placeholders", async () => {
  const html = `<a href="mailto:info@joescoffee.com">email</a> noreply@joescoffee.com you@example.com`;
  const fetchImpl = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
  const out = await fetchHomepageEmails("https://joescoffee.com", { fetchImpl, ticket: { dryRun: false }, companyName: "Joe's Coffee" });
  expect(out[0]).toBe("info@joescoffee.com");
  expect(out).not.toContain("you@example.com"); // example.com is a placeholder domain
});

it("fails closed to [] on HTTP error", async () => {
  const fetchImpl = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
  expect(await fetchHomepageEmails("https://x.com", { fetchImpl, ticket: { dryRun: false } })).toEqual([]);
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -w workers/site-auditor -- homepage-email` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { extractEmails, bestBusinessEmail, isPlaceholderEmail } from "@william/core";

export async function fetchHomepageEmails(
  url: string,
  opts: { fetchImpl?: typeof fetch; ticket: { dryRun: boolean }; companyName?: string | null },
): Promise<string[]> {
  if (opts.ticket.dryRun || !url) return [];
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const html = await res.text();
    const found = extractEmails(html).filter((e) => !isPlaceholderEmail(e));
    if (found.length === 0) return [];
    const best = bestBusinessEmail(found, { siteUrl: url, companyName: opts.companyName ?? null });
    // best first, then the rest (ranking helper picks the single best; keep order stable)
    return best ? [best, ...found.filter((e) => e !== best)] : found;
  } catch {
    return [];
  }
}
```

> Confirm `extractEmails`, `bestBusinessEmail`, `isPlaceholderEmail` are exported from `@william/core` (they are — `packages/core/src/email.ts`). If `bestBusinessEmail`'s signature differs, match it from `email.ts`.

- [ ] **Step 4: Run — expect pass**

Run: `npm test -w workers/site-auditor -- homepage-email` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(site-auditor): cheap homepage email fetch (no browser, dry-run safe)"
```

### Task 13: Reorder the pipeline — contact before audit

**Files:**
- Modify: `workers/orchestrator/src/pipelines.ts` (`ingestLead`, `handleContact`, `handleAudit`)
- Test: `workers/orchestrator/test/pipeline.test.ts`

**Interfaces:**
- Consumes: `fetchHomepageEmails` (Task 12).
- Produces: pipeline order `lead.contact → (email found) lead.audit → lead.score → outreach.draft`. No email ⇒ disqualified, no audit enqueued.

- [ ] **Step 1: Write the failing tests**

```ts
it("intake enqueues lead.contact first (not lead.audit)", () => {
  const ctx = makeCtx();
  const { lead } = ingestLead(ctx, baseInput()) as { lead: Lead };
  const jobs = ctx.store.queue.list?.() ?? /* however tests read the queue */ [];
  expect(jobs.some((j) => j.type === "lead.contact" && j.payload.leadId === lead.id)).toBe(true);
  expect(jobs.some((j) => j.type === "lead.audit")).toBe(false);
});

it("contact with no email disqualifies and never enqueues an audit", async () => {
  // lead with a website that yields no email (mock fetch + dry-run crawl => [])
  // run lead.contact handler
  // expect lead.status === "disqualified" and NO lead.audit job enqueued
});

it("contact that finds an email enqueues lead.audit", async () => {
  // lead whose homepage fetch yields info@domain
  // run lead.contact => contact created, lead.audit enqueued with leadId
});
```

(Mirror the existing test harness in `pipeline.test.ts` for queue inspection + handler invocation.)

- [ ] **Step 2: Run — expect fail**

Run: `npm test -w workers/orchestrator -- pipeline` → FAIL.

- [ ] **Step 3: Reorder intake**

In `ingestLead`, change the final enqueue from `lead.audit` to `lead.contact`:

```ts
  ctx.store.queue.enqueue({ type: "lead.contact", payload: { leadId: lead.id }, traceId, leadId: lead.id });
```

- [ ] **Step 4: Rework `handleContact` to discover the email cheaply, then enqueue audit**

`handleContact` no longer reads from an audit (none exists yet). The homepage pass becomes `fetchHomepageEmails(lead.websiteUrl, ...)`; the Playwright `crawlForEmail` stays as rung 2; enrichment stays rung 3. Replace the rung-1 source line:

```ts
  // 1) Cheap homepage pass — plain HTTP GET, no browser. Dry-run safe.
  const homepageTicket = operationalTicket(ctx, "homepage.fetch", { type: "Lead", id: lead.id, leadId: lead.id }, job.traceId, localReadCredential(ctx));
  const auditEmails = lead.websiteUrl
    ? await fetchHomepageEmails(lead.websiteUrl, { ticket: { dryRun: homepageTicket.dryRun }, companyName: emailCtx.companyName })
    : [];
  let resolvedEmail = bestBusinessEmail(auditEmails, emailCtx);
```

Remove the `const audit = ctx.store.audits.get(...)` line and any `audit?.extracted...` reads in `handleContact` (phones come from the audit later — set `phone: null` on the contact here; it is re-derivable). At the END of `handleContact`, after `contact_ready`, enqueue the AUDIT (not the score):

```ts
  setLeadStatus(ctx, lead, "contact_ready");
  ctx.store.writeActivity(lead.id, "contact_found", `Contact ${contact.email} (${contact.emailSource}, ${contact.verification})`, { traceId: job.traceId });
  ctx.store.queue.enqueue({ type: "lead.audit", payload: { leadId: lead.id }, traceId: job.traceId, leadId: lead.id });
```

The no-email disqualify branch (and the OwnerRequest) is unchanged but now simply returns without enqueuing anything (no audit).

- [ ] **Step 5: Rework `handleAudit` to enqueue score (not contact)**

`handleAudit` runs after contact now. Change its terminal enqueue from `lead.contact` to `lead.score`, passing the `auditId`:

```ts
  setLeadStatus(ctx, lead, "audited");
  ctx.store.writeActivity(lead.id, "audit_completed", audit.summary, { traceId: job.traceId, data: { auditId: audit.id, auditScore: audit.auditScore } });
  ctx.store.queue.enqueue({ type: "lead.score", payload: { leadId: lead.id, auditId: audit.id }, traceId: job.traceId, leadId: lead.id });
```

(`handleScore` already reads `job.payload.auditId` and reads the resolved contact — unchanged. It still defers Lighthouse + visual scoring, which now correctly only runs for emailable leads since contact precedes audit.)

- [ ] **Step 6: Run — expect pass**

Run: `npm test -w workers/orchestrator -- pipeline` → PASS. Fix the existing audit/contact/score tests that asserted the old order (e.g. "audit enqueues lead.contact" → now "contact enqueues lead.audit"; "contact runs before score" still holds via audit in between).

- [ ] **Step 7: Typecheck + full suite + demo + commit**

Run: `npm run typecheck`, `npm test`, `npm run demo` (0 dead-letter).

```bash
git add -A && git commit -m "feat(pipeline): discover email before auditing (no audit without an email)"
```

### Task 14: Score-gate emailing at `outreachScoreThreshold`

**Files:**
- Modify: `workers/orchestrator/src/pipelines.ts` (`handleScore`), `workers/orchestrator/src/sourcing.ts` (`countQualified` caller), remove `QUALIFIED_MIN_SCORE` literal.
- Test: `workers/orchestrator/test/pipeline.test.ts`, `sourcing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("does not enqueue outreach.draft when score <= threshold", async () => {
  // configure ctx.config.outreachScoreThreshold = 45
  // craft an audit that scores, say, 40 (<=45)
  // run lead.score => no outreach.draft job; lead stays scored (kept, not emailed)
});
it("enqueues outreach.draft when score > threshold", async () => {
  // audit that scores 60 => outreach.draft enqueued
});
```

- [ ] **Step 2: Run — expect fail.** Run: `npm test -w workers/orchestrator -- pipeline`.

- [ ] **Step 3: Implement the gate in `handleScore`**

Replace the `result.tier === "skip"` disqualify with a threshold gate. After inserting the `leadScores` row and `lead_scored` activity:

```ts
  if (result.score <= ctx.config.outreachScoreThreshold) {
    setLeadStatus(ctx, lead, "scored");
    ctx.store.writeActivity(lead.id, "below_threshold", `Score ${result.score} not above threshold ${ctx.config.outreachScoreThreshold} — kept, not emailed`, { traceId: job.traceId });
    return;
  }
  setLeadStatus(ctx, lead, "scored");
  const contact = ctx.store.contacts.list({ leadId: lead.id })[0];
  if (!contact) { setLeadStatus(ctx, lead, "disqualified", "No contact at score time"); return; }
  ctx.store.queue.enqueue({ type: "outreach.draft", payload: { leadId: lead.id, contactId: contact.id, auditId: audit.id }, traceId: job.traceId, leadId: lead.id });
```

- [ ] **Step 4: Make sourcing use the config threshold**

In `pipelines.ts` delete `const QUALIFIED_MIN_SCORE = 35;` and in `handleLeadSource` replace `countQualified(ctx, run.leadIds, QUALIFIED_MIN_SCORE)` with `countQualified(ctx, run.leadIds, ctx.config.outreachScoreThreshold)`. (`countQualified` already takes the min score as a param — confirm in `sourcing.ts`; it gates on `score > min`, which matches "above threshold".)

- [ ] **Step 5: Run — expect pass.** Fix `sourcing.test.ts` fixtures that assumed `>35` (seed scores above 45 to qualify). Run full suite + typecheck.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(pipeline): gate emailing on score > OUTREACH_SCORE_THRESHOLD (default 45)"
```

### Task 15: Push mode — auto-grant + enqueue send when `pushMode === "auto"`

**Files:**
- Modify: `workers/orchestrator/src/pipelines.ts` (`handleDraft`)
- Test: `workers/orchestrator/test/pipeline.test.ts`

**Interfaces:**
- Consumes: `decideApproval` (from `./approvals`).

- [ ] **Step 1: Write the failing tests**

```ts
it("review mode: draft awaits approval, no send enqueued", async () => {
  // ctx.config.pushMode = "review"
  // run outreach.draft => draft pending_approval, lead draft_ready, NO outreach.send job
});
it("auto mode: draft is auto-granted and outreach.send is enqueued", async () => {
  // ctx.config.pushMode = "auto"
  // run outreach.draft => approval granted, outreach.send job enqueued for the draft
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement in `handleDraft`**

Add `import { decideApproval, requestApproval } from "./approvals";` (requestApproval already imported). After the existing `requestApproval(...)` + `outreachDrafts.insert({...pending_approval...})` + `draft_ready`:

```ts
  if (ctx.config.pushMode === "auto") {
    decideApproval(ctx, approval.id, "granted", "auto-push mode (PUSH_MODE=auto)");
    ctx.store.queue.enqueue({ type: "outreach.send", payload: { draftId: draft.id }, traceId: job.traceId, leadId: lead.id });
    ctx.store.writeActivity(lead.id, "auto_push", `Auto-push: send enqueued (DNC re-screened at send).`, { traceId: job.traceId });
  }
```

(`handleSend` re-evaluates `SEND_FIRST_TOUCH` — the granted approval lets the ticket issue — and re-screens DNC + simulates in local. No invariant bypass.)

- [ ] **Step 4: Run — expect pass.** Full suite + typecheck.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pipeline): PUSH_MODE=auto auto-grants the send and enqueues outreach.send"
```

### Task 16: compliance-reviewer on the push path

- [ ] **Step 1: Dispatch `compliance-reviewer`** on the diff of `handleDraft`, `handleSend`, and the decide-route trim (Phase 1 Task 6) vs `main`. Verify: every send still passes `evaluateGate` + DNC screen; auto-grant cannot bypass DNC/unsubscribe or the policy gate; local stays dry-run. Apply advisories, re-run `npm test`, commit.

---

## Phase 5 — Batch sourcing (multi-niche sweep)

### Task 17: Add `mode` + sweep state to `SourcingRun`

**Files:**
- Modify: `packages/core/src/schema/sourcing.ts`
- Test: `packages/core/test/` sourcing schema test (or add one)

**Interfaces:**
- Produces: `SourcingRun.mode: "normal" | "batch"`, `SourcingRun.nicheQueue: Niche[]` (remaining niches for a batch sweep), `SourcingRun.currentNiche: Niche | null`.

- [ ] **Step 1: Write the failing test**

```ts
it("SourcingRun accepts mode + nicheQueue", () => {
  const run = SourcingRun.parse({ ...minimalRun(), mode: "batch", nicheQueue: ["restaurant","plumber"], currentNiche: "restaurant" });
  expect(run.mode).toBe("batch");
});
it("mode defaults to normal", () => {
  const run = SourcingRun.parse(minimalRunWithoutMode());
  expect(run.mode).toBe("normal");
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement schema fields**

In `sourcing.ts` add to the zod object: `mode: z.enum(["normal","batch"]).default("normal")`, `nicheQueue: z.array(NicheEnum).default([])`, `currentNiche: NicheEnum.nullable().default(null)`. (Use the existing `Niche` enum from the same package.)

- [ ] **Step 4: Run — expect pass.** Typecheck (Store/whitelist already pass through unknown fields via the schema). Commit.

```bash
git add -A && git commit -m "feat(sourcing): SourcingRun gains mode + niche-sweep state"
```

### Task 18: Batch sweep in the `lead.source` controller

**Files:**
- Modify: `workers/orchestrator/src/pipelines.ts` (`handleLeadSource`)
- Test: `workers/orchestrator/test/sourcing.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("batch run: no early stop on qualified target; advances niche when a niche is exhausted", async () => {
  // mock places: niche A returns 1 page then empty; niche B returns 1 page
  // batch run with candidateCap 10, nicheQueue [A,B]
  // after exhausting A, currentNiche advances to B; ingests from both; stops at cap or empty queue
});
it("batch run stops at candidate cap", async () => { /* cap 2 => stopped_cap after 2 ingested */ });
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement batch branch in `handleLeadSource`**

After loading `run`, branch on `run.mode`. For `"normal"`, keep the existing logic but the qualified-target stop stays. For `"batch"`:
- Skip the `qualifiedCount >= run.target` early stop (batch is cap-governed).
- Use `run.currentNiche ?? run.nicheQueue[0]` for the Places query niche.
- When `page.businesses.length === 0`: advance — set `currentNiche` to the next niche in `nicheQueue` (drop the exhausted head), reset `nextPageToken` to undefined, re-enqueue. If the queue is empty, `stop("stopped_exhausted", ...)`.
- Ingest up to remaining cap with `niche: currentNiche` (not `run.niche`).
- Stop conditions: `candidatesIngested >= candidateCap` → `stopped_cap`; `checks > MAX_SOURCING_CHECKS` → `failed`.

Concretely, factor the niche selection + the Places call:

```ts
  const sweeping = run.mode === "batch";
  const niche = sweeping ? (run.currentNiche ?? run.nicheQueue[0] ?? run.niche) : run.niche;
  // ...gate + searchBusinesses with nicheSearchQuery(niche, run.location)...
  if (page.businesses.length === 0) {
    if (sweeping) {
      const rest = run.nicheQueue.filter((n) => n !== niche);
      if (rest.length === 0) { stop("stopped_exhausted", `Swept all niches — ${qualifiedCount} qualified, ${updated.candidatesIngested} ingested.`); return; }
      ctx.store.sourcingRuns.save({ ...updated, currentNiche: rest[0]!, nicheQueue: rest, nextPageToken: undefined, checks, updatedAt: nowIso() });
      reEnqueue();
      return;
    }
    stop("stopped_exhausted", `No more results — found ${qualifiedCount} of ${run.target}.`);
    return;
  }
  // ingest with `niche` (above) instead of run.niche
```

- [ ] **Step 4: Run — expect pass.** Full suite + typecheck + demo. Commit.

```bash
git add -A && git commit -m "feat(sourcing): batch mode sweeps all niches up to the business cap"
```

### Task 19: API + dashboard for batch sourcing

**Files:**
- Modify: `apps/api/src/server.ts` (`POST /sourcing-runs`), `apps/dashboard/src/pages/SourcingPage.tsx`
- Test: `apps/api/test/server.test.ts`

- [ ] **Step 1: Write the failing API test**

```ts
it("POST /sourcing-runs accepts mode=batch and seeds the niche queue", async () => {
  // post { location, mode: "batch", candidateCap: 50 }
  // expect run.mode === "batch" and nicheQueue = all niches (NICHE_META keys minus "other")
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement the route**

In `POST /sourcing-runs`, read `mode` (default `"normal"`). For `"batch"`: ignore `niche`/`target`, set `nicheQueue = Object.keys(NICHE_META).filter((n) => n !== "other")`, `currentNiche = nicheQueue[0]`, `target = candidateCap` (so the run is cap-governed), and store `mode: "batch"`. For `"normal"`: unchanged (require `niche` + `target`).

- [ ] **Step 4: Dashboard form**

In `SourcingPage.tsx` add a "Batch (sweep all niches)" checkbox. When checked, hide the niche dropdown + target field and show only the business-cap input; POST `{ location, mode: "batch", candidateCap }`. When unchecked, current behavior.

- [ ] **Step 5: Run + build + commit**

Run: `npm test`, `npm run typecheck`, `cd apps/dashboard && npm run build`.

```bash
git add -A && git commit -m "feat(sourcing): batch-sweep option in API + Source-leads form"
```

---

## Phase 6 — Dashboard: clean Leads page with inline email + approve

### Task 20: Leads page shows email + Approve & push / Reject inline

**Files:**
- Modify: `apps/dashboard/src/pages/LeadsPage.tsx` (and reuse the existing approve flow from `LeadDetail.tsx` / Review Queue)
- Test: dashboard build.

- [ ] **Step 1: Implement**

Ensure the Leads table shows `company`, `email` (from the lead's contact), `score`, `status`. For a lead whose draft is `pending_approval`, show the drafted email inline (expandable) with **Approve & push** / **Reject** buttons that fetch the lead's pending approval from `GET /api/review-queue` and POST to `POST /api/approvals/:id/decide` (existing gated route). In `auto` mode (`/api/overview` exposes `pushMode`), render the table read-only (no buttons) with a "Auto-push ON" badge. Reuse the existing approve helper already present in `LeadDetail.tsx` (added in the send-fix work) rather than writing a new endpoint.

- [ ] **Step 2: Expose `pushMode` + `outreachScoreThreshold` on `/api/overview`**

In `apps/api/src/server.ts` `/api/overview`, add `pushMode: ctx.config.pushMode` and `outreachScoreThreshold: ctx.config.outreachScoreThreshold` to the response (alongside the existing flag exposure).

- [ ] **Step 3: Build + commit**

Run: `cd apps/dashboard && npm run build`, root `npm run typecheck`, `npm test`.

```bash
git add -A && git commit -m "feat(dashboard): Leads page shows email + inline Approve & push (review mode) / monitoring (auto)"
```

---

## Phase 7 — Docs rewrite + final verification

### Task 21: Rewrite `CLAUDE.md`, `README.md`, `handoff.md`

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `handoff.md`

- [ ] **Step 1: Rewrite `CLAUDE.md`**

Replace the body with standards for the outreach-only tool: the one-job description; the **Powell** canary (keep verbatim); the commands table (drop demo-only-builder commands if any); the kept invariants (DNC absolute; local = dry-run; side-effects need a ticket; inbound/scraped text is DATA; opt-out line is compliance text `validateDraft` enforces); the two settings (`OUTREACH_SCORE_THRESHOLD`, `PUSH_MODE`) and where they live; the pipeline order (`source → contact → audit → score → draft → push`); normal vs batch sourcing; the email rules; the trimmed dashboard. Remove the ACTIVE-PIVOT banner and the Phase A-F / builder / billing / brief history. Add a short "Pivot 2026-06-28: scrapped website building, billing, calendar, follow-ups, and all inbound reply handling; see git history / `docs/superpowers/specs/2026-06-28-outreach-tool-pivot-design.md`."

- [ ] **Step 2: Rewrite `README.md`** to match (setup, the two settings, run commands, Instantly campaign template note: map `{{email_subject}}` / `{{email_body}}`).

- [ ] **Step 3: Rewrite `handoff.md`** to a fresh outreach-tool status: what's done, the two settings, how to vet 50 leads in review mode then flip `PUSH_MODE=auto`, remaining activation items (live Places/Instantly/Anthropic paths, compliance re-review before first real send).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: rewrite CLAUDE.md + README + handoff for the outreach-only tool"
```

### Task 22: Final verification

- [ ] **Step 1: Full green run**

Run: `npm run typecheck` (clean), `npm test` (green — record final count), `npm run demo` (0 dead-letter), `cd apps/dashboard && npm run build` (clean).

- [ ] **Step 2: Grep for stragglers**

Run: `git grep -in "website brief\|site.ship\|billing\|stripe\|vercel\|follow-up\|followup\|experiment\|deploy" -- '*.ts' '*.tsx'` and confirm only legitimate residue (e.g. comments) remains. Remove any dead references.

- [ ] **Step 3: Use `superpowers:finishing-a-development-branch`** to decide how to integrate `outreach-tool` (merge to main / PR), per the owner.

---

## Self-Review (author check against the spec)

- **§2 scrap list:** Tasks 1-7 remove follow-ups (1,3), website building (1,2), billing (1,2,4,6), calendar (1,2), inbound reply handling (1,3,4,6), experiments/reports (5), Vercel/Gmail (4). ✓
- **§3 kept framework:** Places (kept; batch in 17-19), audit (kept; reordered 13), `scoreLead` + visual (kept; gated 14), email discovery (kept; cheap pass 12), store/queue/API/dashboard (kept; trimmed), safety rails (kept; compliance 11,16). ✓
- **§4 two settings:** Task 8 (config), enforced in 14 (threshold) + 15 (push mode). ✓
- **§5 reorder / no audit without email:** Tasks 12-13. ✓
- **§6 email rules:** Task 9 (deterministic template; Task 10 removed — no LLM copy), Task 11 compliance. ✓ (≤5 sentences, no emdash, P.S. opt-out, no URL, Cornell, mockup.)
- **§7 push modes:** Task 15 (+ decide-route trim in 6, dashboard in 20). ✓
- **§8 sourcing modes:** Tasks 17-19. ✓
- **§9 dashboard:** Tasks 7 (trim) + 20 (leads) + 19 (sourcing form). ✓
- **§10 docs final step:** Task 21. ✓
- **Placeholder scan:** deletion tasks name specific modules/handlers; new-logic tasks carry full code. The only "find the file" steps are `git grep` discovery for deletions (acceptable — exact removal targets are named). ✓
- **Type consistency:** `fetchHomepageEmails` (12) consumed in 13; `decideApproval` (15) exists in `approvals.ts`; `countMessageSentences`/`OPT_OUT_LINE` (9) consistent; `SourcingRun.mode/nicheQueue/currentNiche` (17) consumed in 18-19. ✓
