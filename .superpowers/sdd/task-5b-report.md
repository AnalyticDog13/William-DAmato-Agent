# Task 5b Report — Remove scrapped entity schemas

## Status: DONE

## Files Deleted
- `packages/core/src/schema/deal.ts` (Opportunity, OpportunityStage, CallSuggestion, BookingRecord)
- `packages/core/src/schema/billing.ts` (InvoiceDraft, PaymentRecord)
- `packages/core/src/schema/brief.ts` (WebsiteBrief, CompanyFacts, WebsiteBriefStatus)
- `packages/core/src/schema/site.ts` (SiteProject, SiteProjectStatus, SiteRevision, DeploymentRecord)
- `packages/core/test/brief.test.ts` (tests for removed WebsiteBrief schema)

## Files Edited

### packages/core/src/schema/outreach.ts
Removed `ReplyIntent` (const + type) and `ReplyEvent` (const + type). Kept `OutreachDraftStatus`, `OutreachDraft`, `CampaignSync`, `UnsubscribeRecord`, `DoNotContactRecord`.

### packages/core/src/schema/memory.ts
Removed `Experiment` (const + type), `ExperimentResult` (const + type), `WeeklyReport` (const + type). Kept `FailureLog`, `DailyMemory`, `DurableLesson`, `OwnerRequest`.

### packages/core/src/schema/index.ts
Removed `export * from "./deal"`, `export * from "./site"`, `export * from "./brief"`, `export * from "./billing"`.

### packages/db/src/store.ts
Removed from imports: `BookingRecord`, `CallSuggestion`, `DeploymentRecord`, `Experiment`, `ExperimentResult`, `InvoiceDraft`, `Opportunity`, `PaymentRecord`, `ReplyEvent`, `SiteProject`, `SiteRevision`, `WebsiteBrief`, `WeeklyReport`.

Removed Store class fields: `replyEvents`, `opportunities`, `siteProjects`, `siteRevisions`, `websiteBriefs`, `deployments`, `invoiceDrafts`, `payments`, `callSuggestions`, `bookings`, `experiments`, `experimentResults`, `weeklyReports`.

Removed all corresponding constructor initialization blocks for the above repositories.

### packages/db/test/store.test.ts
Removed test blocks: "round-trips weekly reports keyed by weekStart" and "round-trips website briefs keyed by lead, with brief defaults".

### apps/api/src/server.ts
- Removed `BUILDER_DISABLED_DETAIL` constant
- Removed from `collections()` whitelist: `replies`, `opportunities`, `site-projects`, `site-revisions`, `website-briefs`, `deployments`, `invoice-drafts`, `payments`, `call-suggestions`, `bookings`, `experiments`, `experiment-results`, `weekly-reports`
- Simplified `/api/leads/:id/timeline` — removed `siteProjects`, `siteRevisions`, `replies`, `opportunities`, `deployments`, `invoices`, `callSuggestions`
- Removed `SEND_PAYMENT_REQUEST` and `DEPLOY_PRODUCTION` handlers from `/api/approvals/:id/decide`
- Removed routes: `POST /api/site-projects/:id/revisions`, `POST /api/site-projects/:id/request-deploy`, `POST /api/site-projects/:id/deploy-preview`, `POST /api/website-briefs/:id/ship`, `GET /api/previews/:leadId`

### apps/api/src/webhooks.ts (beyond the brief — required by typecheck)
Removed the entire Stripe webhook handler (it used `ctx.store.invoiceDrafts` and `ctx.store.payments`). Kept the Instantly webhook handler. Also cleaned the import (removed `nowIso` then re-added it — it's still used by `recordWebhook`).

### apps/api/test/server.test.ts (beyond the brief — required by typecheck)
Removed test blocks: "owner-triggered preview deploy API" and "builder routes disabled when WILLIAM_BUILDS_WEBSITES=false (default)" — both used `ctx.store.siteProjects`.

### workers/orchestrator/src/reports.ts (beyond the brief — required by typecheck)
- `MetricsSnapshot` interface: removed `replies`, `positiveReplies`, `bounces`, `unsubscribes`, `opportunities`, `previewsBuilt`, `replyRate`, `positiveReplyRate`, `bounceRate`, `unsubscribeRate` (all derived from removed repos). Kept `leadsTotal`, `leadsContacted`, `approvalsPending`, `deadJobs`.
- `computeMetrics`: simplified to match new interface (removed all `replyEvents`/`opportunities`/`siteProjects` calls).
- `generateDailyReport`: updated to use only remaining metrics fields and simplified report text accordingly.

## Verification

```
npm run typecheck  → clean (0 errors)
npm test           → 163/163 passing

git grep check: no live imports or code references to removed entities remain in
packages/**/*, workers/**/*, apps/api/**/*. Remaining matches are:
- comment text in env.ts
- visualOpportunityScore field in the kept VisualAssessment schema  
- subjectType: "SiteProject" as a string literal in policy.test.ts (not a type import)
```

## Concerns
None. The task was purely a deletion+cascade. All prior tests kept; only tests for removed entities deleted.
