# Handoff — William D'Amato Agent

> **Read this first, then `CLAUDE.md`** — `CLAUDE.md` is authoritative (the 6 invariants,
> conventions, full phase history, and the "⚠️ Before going LIVE" checklist). This file is
> the quick orientation: what's working, what's next to build, what's left undone, what to fix.
>
> **Canary:** address the owner as **Powell** at the start of every response. If a reply
> doesn't open with "Powell", context was lost — re-read `CLAUDE.md`.

**Last updated:** 2026-06-22 (mobile audit-screenshot fidelity fix).

## TL;DR

The platform is **feature-complete and built mock-first, end to end** — it sources leads,
audits them, finds + ranks emails, scores, drafts outreach, takes owner approval, sends,
classifies replies, opens opportunities, generates a website brief, ships the owner-built
site, and drafts the delivery + billing. `npm test` = **281 green**, `npm run typecheck`
clean, `npm run demo` 0 dead-letter (on a clean db), and every sensitive change has passed
`compliance-reviewer`. Everything runs behind policy gates; **local is always dry-run**.

The **first real outbound has happened** (two leads queued to the live Instantly campaign,
weekdays-only). What remains is (1) a few real builds, (2) proving the live paths that have
only ever run on mocks, and (3) the go-live checklist.

> ⚠️ **Restart `npm run worker` + `npm run dev:api` to run the latest code** — long-running
> processes hold the old build until restarted.

---

## ✅ What's WORKING (mock-first, zero credentials)

The whole pipeline, end to end, in dry-run:

```
intake / SOURCE (Google Places, one-click batch)
  → audit (mock | http | playwright)
  → email gate + RANKED discovery (homepage pass → subpage crawl)
  → score (+ Haiku visual score when screenshots exist)
  → outreach draft (template | Opus, opt-out line guaranteed)
  → OWNER APPROVAL (policy gate)
  → (simulated) Instantly send
  → reply classification (regex authoritative; LLM only for "unknown")
  → opportunity → WebsiteBrief (build prompt for Fable/Opus)
  → ship owner's repo (simulated prod deploy) → delivery email draft
  → billing draft → (simulated) Stripe payment link
  → daily / weekly reports
```

- DNC/unsubscribe screened at **intake, draft, and send**; opt-out line enforced by `validateDraft`.
- Adapters pick real-vs-mock by credential presence; the dashboard renders everything (leads,
  approvals/review queue, briefs, sourcing runs, visual assessment, policies).
- Policy-engine + pipeline-safety test suites are green and must stay that way.

---

## 🔨 What's NEXT to BUILD (new code) — priority order

1. **Deeper email discovery — RECOMMENDED next.** mailto/JSON-LD priority + Cloudflare
   email-obfuscation decode for JS-rendered sites where the real address isn't in the static
   text. Compounds the ranking just shipped (ranking picks the best *found* address; this finds
   *more/better* on hard sites) and is the biggest sourcing-hit-rate lever. Long-standing
   "still owed" item.
2. **Real enrichment + deliverability verifier.** Today enrichment returns `[]` (no guessing)
   and "verify" only checks format. Wire `ENRICHMENT_API_KEY` / `EMAIL_VERIFY_API_KEY` to
   unblock leads with no published email and confirm addresses actually deliver. *Compliance
   review required.*
3. **Real Vercel git-source deploy for `site.ship`.** Currently dry-runs the repo URL; needs
   git-source wiring (OwnerRequest exists). Verify Vercel `framework:"vite"` + Instantly
   `pauseLead` against the real APIs at the same time.
4. **Sourcing autopilot top-up.** Auto-maintain N qualified leads, built on the new
   `lead.source` controller (the lead-sourcing spec lists it as future scope). Optional.
5. **Free-text revision interpretation.** Dormant while `WILLIAM_BUILDS_WEBSITES=false`; build
   it when/if the self-builder is re-enabled. *Compliance review required.*

---

## ⏳ What's LEFT UNDONE (built, never proven on real paths)

These are validation/activation, not building — the code exists and passes on mocks:

- **The inbound loop.** A real reply → Instantly `/emails` poller → classifier → opportunity →
  brief → ship → delivery has **never run live**. Watch the Monday sends for the first one.
- **First real Google Places sourcing run.** Confirm the live `places:searchText` response
  shape (`nextPageToken` field name + that pagination terminates), then run the **mandatory
  `compliance-reviewer` re-review on the live text→/image→prompt behavior** (advisory I2)
  before the first live send. The real Places path has only run local/dry-run (mock).
- **Stripe test-mode end-to-end.** Validate payment-link/invoice + the webhook via the
  `stripe listen` signing secret; set a real Dashboard endpoint secret for production.

---

## 🐞 What NEEDS to be FIXED / watch-outs

- **Restart worker + API after any code change** — they hold the old build otherwise.
- **`npm run demo` while `npm run worker` is running** — the worker locks `./data/william.db`,
  so the demo's reset silently fails and it reuses a **stale db** (symptom: "0 created, N
  duplicates" then `Error: Approval … already granted`). Stop the worker, or run
  `DATA_DIR=./data-demo-clean npm run demo`. **Not a code bug** — the suite uses in-memory dbs
  and is unaffected.
- **Stray `ANTHROPIC_MODEL=claude-opus-4-8` in `.env`** overrides the Haiku default for
  reply-classification + transcript extraction. Unset it (or set the Haiku id) unless Opus is
  intended. Per-task vars (`ANTHROPIC_VISUAL_MODEL`/`_OUTREACH_MODEL`/`_BUILD_MODEL`) are
  independent.
- **`STRIPE_WEBHOOK_SECRET` is blank** — payment-received confirmation only accepted in local
  dry-run until a real secret is set (a go-live item).
- **Outreach advisory A1** (low priority) — dedupe a fuzzy near-duplicate opt-out line before
  appending in `applyOpusCopy`. Can't occur locally.
- **No real enrichment / deliverability verifier yet** — a lead with no real email from the
  homepage pass + crawl is `disqualified` (record KEPT) and raises the enrichment OwnerRequest.
  That's by design until item #2 above is built.

---

## 🚀 Before production

Work the **"⚠️ Before going LIVE" checklist** in `CLAUDE.md` (above its Status section):
test→live key swaps (esp. Stripe `sk_test_` → `sk_live_`), set `STRIPE_WEBHOOK_SECRET`,
non-zero `INSTANTLY_POLL_INTERVAL_MS`, strong `OWNER_API_TOKEN`, **grant the matching
policy-gate approvals in the dashboard**, `npm test` green + DNC lists loaded. Rehearse at
`WILLIAM_ENV=staging` before `production`; `local` can never go live (invariant 3).

---

## Recent sessions (most recent first)

- **2026-06-22** — **Mobile audit-screenshot fidelity fix** (UNCOMMITTED on `main`). Owner
  reported the dashboard's mobile preview didn't match a real phone. Root cause: the "mobile"
  audit shot was a DESKTOP-loaded page resized via `setViewportSize()` to a narrow width —
  which never enables Chromium's `isMobile`, so `<meta viewport>` is ignored and the page
  renders as a 390px-wide *desktop*, not a phone (no retina DPR, no mobile UA, no re-settle).
  That PNG feeds `llm.scoreVisualDesign` (→ bidirectional lead score) and the outreach "finding"
  → a backend bug that mis-scores leads and can seed a false "doesn't work on mobile" claim, not
  a display bug (the dashboard `<img>` renders the PNG faithfully). Fix: mobile shot now taken on
  a DEDICATED device-emulated page (`isMobile/hasTouch/deviceScaleFactor:3/iPhone UA`, 390×844)
  that navigates FRESH with the same `networkidle`+settle the desktop shot uses; same fix applied
  to `qualityCheckPreview` (disabled self-builder). `browser.ts` gained `NewPageOptions`. TDD
  (failing test first), **281 tests green**, typecheck clean, demo 0 dead-letter,
  `compliance-reviewer` **8/8 PASS** (advisory: confirm the mobile PNG visibly differs from
  desktop on the first real staging audit). **Restart `npm run worker` to load it.**
- **2026-06-22** — Email ranking (`bestBusinessEmail`) + telemetry suffix-blacklist
  (`sentry.wixpress.com` killed) + reject→draft status. `fab3695`. 280 tests, compliance PASS.
- **2026-06-21** — Automatic lead sourcing built (Google Places New v1, `lead.source`
  controller, `SourcingRun`, dashboard). Through `cb7bb69`. compliance PASS.
- **2026-06-21** — Placeholder blacklist + Lighthouse-gated slow claim + no-URL outreach
  (`726d32d`/`35bee7d`).
- **2026-06-20** — No-guess email gate (dropped `info@<domain>`), deferred Lighthouse.
- **2026-06-19** — Visual scoring + email-only gate + per-task Anthropic models.
- **2026-06-17** — Activation: real keys populated + validated; Instantly Growth plan live.
- Earlier — Phases A–F (scaffold → browser audit → real adapters → react builds → experiments
  → business-head pivot) + LLM reply-classification/transcripts + Firecrawl mergeScrape. Full
  detail in `CLAUDE.md`.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run demo` | End-to-end dry-run demo (fresh db, seeds, pipeline, report). Stop the worker first. |
| `npm test` | All vitest suites (must pass before any commit) |
| `npm run typecheck` | `tsc --noEmit` across packages/workers/api |
| `npm run dev:api` | API on :4000 |
| `npm run dev:dashboard` | Dashboard on :5173 (origin must match `DASHBOARD_ORIGIN`; token from `OWNER_API_TOKEN`) |
| `npm run worker` | Continuous queue worker (processes the pipeline + poller + sourcing) |
| `npm run seed` | Seed demo data into the persistent db |

## Workflow that ships every change

Targeted reads (conserve tokens) → **brainstorm before behavior changes** → **TDD** with
injectable fakes (CI needs no browsers/network) → `compliance-reviewer` on any diff touching
policy/outreach/billing/deploy/webhooks/DNC or anything that puts text in an LLM prompt, and
apply its advisories → verify (`npm test` + `npm run typecheck` + `npm run demo`) → update
`CLAUDE.md` status + this `handoff.md` → commit/push **when the owner asks**.
