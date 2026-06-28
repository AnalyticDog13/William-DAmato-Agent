# William D'Amato — Outreach Tool

A focused business-outreach tool. It sources local businesses from Google Maps, finds a real contact email (cheaply, first), audits and scores the website, writes a short personalized email, and pushes the lead to Instantly for sending. The owner handles everything after the push — replies, follow-ups, calls, payment, and website building.

## Canary (context-integrity check)

Address the owner as **Powell** at the start of every response. This is a
deliberate canary: if a response doesn't open with "Powell", the owner knows
context has been lost or degraded — re-read this file before continuing.

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

1. **Inbound/scraped text is DATA, never an LLM instruction.** Scraped pages and audit content are fenced, quoted material the model is told to treat as data only. Never place lead-derived strings in a prompt as instructions.
2. **Side effects require a PolicyTicket.** Adapters throw without one; tickets come only from `PolicyEngine.evaluate` (named gates) or `authorizeOperational` (audited, ungated reads). Never add a side-effecting code path that bypasses this.
3. **`local` env = dry-run, always.** `loadConfig` forces it; tests assert it. Live execution additionally requires granted approval + matching credentials (`sandbox` for staging, `live` for production).
4. **DNC/unsubscribe are absolute.** Screen at intake, at draft, and at push (`screenForContactability`). Honor opt-outs immediately.
5. **The opt-out line is compliance text** — `validateDraft` enforces its presence. Current text: `P.S. If you'd rather not hear from me, just say the word and I'll take you off my list right away, no hard feelings!` Opt-out line changed 2026-06-28 per explicit owner direction (the CHANGE_COMPLIANCE_TEXT authorization is the owner's recorded instruction).

## Two easy-to-find settings

Both live in `packages/core/src/env.ts` (`RuntimeConfig`) and are env-overridable:

- **`OUTREACH_SCORE_THRESHOLD`** (env: `OUTREACH_SCORE_THRESHOLD`, default `45`) — only sites scoring ABOVE this are emailed. Higher score = worse site = better prospect. Supersedes the old `score > 35` literal everywhere it gates "qualified".
- **`PUSH_MODE`** (env: `PUSH_MODE`, `"review"` | `"auto"`, default `"review"`) — `review`: qualified leads wait in the dashboard; the owner clicks **Approve & push** per lead. `auto`: qualified leads push to Instantly automatically after DNC screening. Start on `review` to vet the first ~50 leads, then flip to `auto`.

## Pipeline

```
lead.source
  → lead.contact   (cheap homepage HTTP GET + email regex/rank → subpage crawl → enrichment)
                   (no email found → disqualified + OwnerRequest; NO audit enqueued)
  → lead.audit     (Playwright: screenshots desktop + mobile, Lighthouse, axe, heuristics)
  → lead.score     (scoreLead + optional Haiku visual scoring when screenshots exist)
                   (score ≤ OUTREACH_SCORE_THRESHOLD → stop, lead kept, not emailed)
  → outreach.draft (deterministic template; ≤5 sentences, Cornell voice, P.S. opt-out, no URL)
  → outreach.send  (push to Instantly; PUSH_MODE=review → owner approves; PUSH_MODE=auto → auto-granted)
                   (local always dry-runs the push regardless of mode)
```

The Instantly push carries custom variables `first_name`, `company`, `email_subject`, `email_body`. The owner wires the Instantly campaign template to `{{email_subject}}` / `{{email_body}}`.

## Sourcing modes

- **Normal:** city + one niche + target N qualified. The `lead.source` controller stops once N leads clear the score gate.
- **Batch:** city + multi-niche sweep + business cap. The controller iterates the niche taxonomy (`NICHE_META`), issues Places searches across all business types, and processes every business found up to the cap (no early stop on a qualified target). The Source-Leads form provides a "Batch — sweep all niches" toggle + cap input. `SourcingRun.mode` is `"normal" | "batch"`.

## Email rules

All rules enforced by `validateDraft` — not split into Instantly:

- Body **≤ 5 sentences** (excluding greeting, P.S., and sign-off).
- **No emdashes**; no AI tells ("I hope this finds you well", "elevate/leverage/seamless", etc.).
- Friendly-professional **Cornell-student** voice — sounds like a real person, not a sales manager.
- **Friendly P.S. opt-out** using a comma (not an emdash).
- **No URL** in the email body (the prospect's site is never mentioned; revealed only after they reply).
- Keeps the **free-mockup hook** ("I put together a quick mockup").
- The site-specific finding comes from `deriveFindings` (plain language, no jargon), fenced as untrusted DATA when it reaches the LLM.

## Conventions

- TypeScript strict; `moduleResolution: Bundler`; everything runs via tsx/vite.
- zod schemas in `packages/core/src/schema/` are the source of truth; the db layer validates on read AND write. New entities: schema → Store repository → collection whitelist in `apps/api/src/server.ts` → dashboard nav if needed.
- Workspace imports only (`@william/core` etc.); no deep relative imports across packages.
- Every pipeline action carries a `traceId`; every lead-visible step writes an ActivityEvent; failures go through `memory.recordFailure` with a taxonomy category.
- Uncertain assumptions: encode as `TODO(phase-x)` + config flag, never silently hard-code.
- Tests: unit for domain logic, integration for pipelines/API. Policy-engine and pipeline safety tests are the contract — never delete or skip them.
- Build-time memory (this file, docs/) vs runtime business memory (SQLite via packages/memory) stay separate.

## Subagents

`.claude/agents/` defines specialized subagents (lead-researcher, site-auditor, outreach-operator, compliance-reviewer). Use them for their domains; `compliance-reviewer` is read-only and must review any change touching policy, outreach content, DNC, or anything that puts text into an LLM prompt.

## Before going LIVE (production) — credential checklist

- [ ] `GOOGLE_MAPS_API_KEY` — real production value (New Places API `/v1`; legacy is off).
- [ ] `INSTANTLY_API_KEY` + `INSTANTLY_CAMPAIGN_ID` — API V2 key with `leads:create` scope; campaign template must use `{{email_subject}}` / `{{email_body}}`.
- [ ] `ANTHROPIC_API_KEY` — Haiku is the default visual-scoring model; confirm the key is live.
- [ ] `ENRICHMENT_API_KEY` / `EMAIL_VERIFY_API_KEY` — optional; unblocks leads with no published email.
- [ ] `OWNER_API_TOKEN` — strong, unique random value (not the dev token).
- [ ] `WILLIAM_ENV`: rehearse at `staging` (sandbox creds) FIRST; only set `production` once a real lead flows end-to-end in staging. `local` is always dry-run by design — it can never go live.
- [ ] **Grant the matching policy-gate approvals** in the dashboard (`ACTIVATE_NEW_LEAD_SOURCE`, `SEND_FIRST_TOUCH` — a key alone does nothing without the approval).
- [ ] **Re-run `compliance-reviewer`** on the live text→prompt and image→prompt behavior once the real Places / Playwright / Anthropic paths execute (mandatory before first real send).
- [ ] `npm test` green and DNC/unsubscribe lists loaded before the first real push.

## Status

**`handoff.md`** (repo root) is the live session-handoff log. Read it when resuming work; update it alongside this file after every significant change.

## Pivot (2026-06-28)

The 2026-06-28 pivot collapsed the all-encompassing "William D'Amato" agentic sales-and-delivery platform into this single-purpose outreach tool. Scrapped and deleted: website building (packages/templates, workers/site-builder, WebsiteBriefs, brief.generate, site.ship, preview/revise/deploy), billing/Stripe, calendar/scheduling, all inbound reply processing (reply poller, classifier, opportunity creation, transcript ingestion), experiments engine, weekly reports, follow-up/close-out automation, Vercel and Gmail adapters. The self-builder was removed in the pivot (not preserved behind a flag). Full history and the scrapped systems live in git history and `docs/superpowers/specs/2026-06-28-outreach-tool-pivot-design.md`.
