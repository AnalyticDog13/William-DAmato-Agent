# Phase B — Playwright Browser-Grade Auditing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.
> (Compact plan per owner's token-conservation rule; code lives in the commits, not duplicated here.)

**Goal:** Real browser auditing behind `AUDITOR_MODE=playwright` — screenshots, Lighthouse, axe-core — with graceful fallback to `http` mode when browsers are missing, plus a Playwright quality gate on generated previews.

**Architecture:** New `browser.ts` (chromium launcher with availability detection, injectable for tests) and `playwright-audit.ts` (audit + preview quality check) in workers/site-auditor. Orchestrator passes `dataDir` + optional `browserLauncher` (on AppContext) so tests inject a null launcher. Lighthouse runs over CDP port; axe-core injected as script. Preview QC serves the generated HTML over an ephemeral local HTTP server (Lighthouse can't audit file:// URLs).

**Tech stack:** playwright, lighthouse, axe-core (deps of workers/site-auditor only).

### Task 1: Schemas
- [x] `packages/core/src/schema/audit.ts`: `AuditedPage.mobileScreenshotPath` (nullable, default null)
- [x] `packages/core/src/schema/site.ts`: `SiteProject.qualityCheck` ({lighthousePassed, a11yPassed, notes[]} nullable, default null — same shape as DeploymentRecord.qualityChecks)

### Task 2: Auditor — fallback + playwright mode (TDD)
- [x] Add deps playwright/lighthouse/axe-core to workers/site-auditor; npm install
- [x] Failing tests `workers/site-auditor/test/playwright.test.ts`: (a) mode=playwright + null launcher → http-mode audit, no crash; (b) qualityCheckPreview + null launcher → null; (c) fake-browser success path: mode stays playwright, screenshots written to `<dataDir>/screenshots/<leadId>/`, a11yFindings populated, lighthouse null when unreachable
- [x] `src/browser.ts`: `MinimalBrowser/MinimalPage` structural types, `ChromiumLauncher`, `launchChromium` (dynamic import, returns null + warn on any failure), `freePort()`
- [x] `src/playwright-audit.ts`: `playwrightAudit` (robots check, goto, desktop 1366×900 + mobile 390×844 screenshots, axe injection, lighthouse via CDP port, reuse extractSignals/deriveFindings; returns null → caller falls back), `qualityCheckPreview` (ephemeral http server over preview dir, screenshot + lighthouse + axe → {lighthousePassed, a11yPassed, notes, screenshotPaths}; thresholds as exported consts with TODO(phase-d) config flag)
- [x] `src/audit.ts`: deps gain `dataDir?`, `launchBrowser?`; playwright mode tries playwrightAudit, falls back to httpAudit (mode recorded as "http"); extract shared `checkRobots`
- [x] Tests green

### Task 3: Orchestrator wiring
- [x] `AppContext.browserLauncher?` in context.ts
- [x] handleAudit passes dataDir + launcher; handlePreviewBuild runs qualityCheckPreview ONLY when `auditorMode === "playwright"` (demo/CI stay mock), stores screenshotPaths + qualityCheck, activity notes pass/fail/skipped
- [x] Pipeline test: playwright mode + null launcher → preview still built, QC skipped gracefully

### Task 4: API + dashboard
- [x] `GET /api/screenshots/:leadId/:file` (owner-authed, basename + root-prefix guard, .png only) in apps/api/src/server.ts + server test (404 + traversal)
- [x] LeadDetail.tsx: authed blob-fetch screenshot figures (desktop/mobile) under audit findings; preview screenshots + quality badge on the preview panel

### Task 5: Verify + docs
- [x] `npm test`, `npm run typecheck`, `npm run demo` (stays mock, no browser needed)
- [x] Update CLAUDE.md status (Phase B done → Phase C next); docs/setup.md auditor-mode note
- [x] Commit
