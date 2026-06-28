# Handoff — William D'Amato Outreach Tool

> **Read this first, then `CLAUDE.md`** — `CLAUDE.md` is authoritative (invariants, conventions, the two settings, the pipeline, and the before-LIVE checklist). This file is the quick orientation: what's working, what's next to activate, and what to watch out for.
>
> **Canary:** address the owner as **Powell** at the start of every response. If a reply doesn't open with "Powell", context was lost — re-read `CLAUDE.md`.

**Last updated:** 2026-06-28 (outreach-tool pivot complete — docs rewrite).

## TL;DR

The pivot is **done and green**. The tool sources local businesses, finds emails, audits sites, scores them, writes a short personalized email, and pushes to Instantly — all mock-first, end to end. `npm test` passes, `npm run typecheck` clean, `npm run demo` runs 0 dead-letter. Every sensitive path has passed `compliance-reviewer`.

**The real paths (Google Places, Instantly `leads:create`, Anthropic visual scoring) have only ever run on mocks.** The immediate next step is a staging rehearsal: vet ~50 leads in `PUSH_MODE=review`, confirm the live API shapes, run `compliance-reviewer` on the live text→/image→prompt behavior, then flip to `PUSH_MODE=auto`.

> **Restart `npm run worker` + `npm run dev:api` after any code change** — long-running processes hold the old build.

---

## What's WORKING (mock-first, zero credentials)

Full pipeline, end to end, in dry-run:

```
lead.source          (Google Places mock; paginated; normal + batch modes)
  → lead.contact     (homepage HTTP GET + email rank; miss → subpage crawl → enrichment)
                     (no email → disqualified + OwnerRequest; no audit enqueued)
  → lead.audit       (mock | http | playwright; screenshots, Lighthouse, axe, heuristics)
  → lead.score       (heuristics + optional Haiku visual scoring when screenshots exist)
                     (score ≤ 45 → not emailed; score > 45 → draft)
  → outreach.draft   (deterministic template: Cornell voice, ≤5 sentences, P.S. opt-out, no URL)
  → outreach.send    (PUSH_MODE=review → owner approves in dashboard; local always dry-runs)
```

- DNC/unsubscribe screened at intake, draft, and push; opt-out line enforced by `validateDraft`.
- Adapters pick real-vs-mock by credential presence; real adapter simulates under dry-run.
- Policy-engine + pipeline-safety test suites are green and must stay that way.
- Dashboard: **Source Leads** (city/niche or batch-sweep + runs list) and **Leads** (table with inline email + Approve & push / Reject in review mode).
- Worker startup auto-reclaims orphaned `running` jobs (restart-safe); send idempotency guard prevents double-push on reclaim.

---

## How to go LIVE

### Step 1 — Staging rehearsal (review mode, ~50 leads)

1. Confirm `WILLIAM_ENV=staging`, `PUSH_MODE=review`, `AUDITOR_MODE=playwright` in `.env`.
2. Run `npx playwright install chromium` if not already installed.
3. Start all three processes: `npm run dev:api`, `npm run dev:dashboard`, `npm run worker`.
4. In the dashboard, grant the `ACTIVATE_NEW_LEAD_SOURCE` approval, then source a small batch (1 niche, low target count, a city you know).
5. Watch leads flow through: confirm the live `places:searchText` response shape (`nextPageToken` field name + that pagination terminates), confirm email discovery finds real addresses, review the drafted emails in the Leads page.
6. For each lead that clears the score gate, click **Approve & push** — confirm the Instantly push returns 200 and the lead appears in the campaign. Watch the worker's job `last_error` for any Instantly `leads:create` (write-scope) errors; the first real push has never run.
7. **Run `compliance-reviewer`** on the live text→prompt (audit findings → email draft) and image→prompt (screenshots → visual scoring) behavior — **mandatory before any real send at scale**.

### Step 2 — Flip to auto

Once you've vetted ~50 leads and the emails look right:

- Set `PUSH_MODE=auto` in `.env`.
- Restart the worker.
- Source a batch run — leads will push to Instantly automatically after DNC screening.

### Step 3 — Production

- Swap all credentials test → live.
- Set `OWNER_API_TOKEN` to a strong unique value (not the dev token).
- Grant all matching policy-gate approvals in the dashboard.
- Run `npm test` green + confirm DNC lists are loaded.
- Set `WILLIAM_ENV=production`.

---

## What Needs Activation (built but only run on mocks)

- **Google Places live shape** — confirm `places:searchText` `nextPageToken` field name and that pagination terminates correctly. Only run local/dry-run (mock) so far.
- **Instantly `leads:create` write scope** — the auth ping (read) returned 200 during activation; the first real `leads:create` call has never run. Watch `job.last_error` on the first push.
- **Anthropic visual scoring** — `llm.scoreVisualDesign` (Haiku vision) only runs in non-local envs with `ANTHROPIC_API_KEY`; always simulated locally. Confirm a sane `VisualAssessment` on real screenshots in staging.
- **Mandatory `compliance-reviewer` re-review** — required before the first real send at scale: re-run the reviewer once the live text→prompt and image→prompt paths have actually executed in staging.

---

## Watch-outs

- **Restart worker + API after any code change** — they hold the old build otherwise.
- **`npm run demo` while `npm run worker` is running** — the worker locks `./data/william.db`, so the demo's reset silently fails and reuses a stale db. Stop the worker first, or run `DATA_DIR=./data-demo-clean npm run demo`. Not a code bug — the suite uses in-memory dbs and is unaffected.
- **`PUSH_MODE=review` is the safe default** — do not flip to `auto` until you've reviewed email quality on real leads.
- **Enrichment is empty by default** — `createMockEnrichment` returns `[]`; a real `ENRICHMENT_API_KEY` is needed to unblock leads with no published email. A lead with no email from homepage + crawl is `disqualified` (record kept).
- **Instantly campaign template** must be wired to `{{email_subject}}` / `{{email_body}}` before any real pushes — William writes the whole email; the campaign is just a passthrough.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run demo` | End-to-end dry-run demo (fresh db, seeds, pipeline). Stop the worker first. |
| `npm test` | All vitest suites (must pass before any commit) |
| `npm run typecheck` | `tsc --noEmit` across packages/workers/api |
| `npm run dev:api` | API on :4000 |
| `npm run dev:dashboard` | Dashboard on :5173 (token: `dev-owner-token` locally) |
| `npm run worker` | Continuous queue worker |
| `npm run seed` | Seed demo data into the persistent db |

## Workflow

Targeted reads (conserve tokens) → TDD with injectable fakes (CI needs no browsers/network) → `compliance-reviewer` on any diff touching policy/outreach/DNC or anything that puts text in an LLM prompt → verify (`npm test` + `npm run typecheck` + `npm run demo`) → update `CLAUDE.md` status + this `handoff.md` → commit/push when the owner asks.
