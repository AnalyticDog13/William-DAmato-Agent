# Outreach-Tool Pivot — Design Spec

**Date:** 2026-06-28
**Branch:** `outreach-tool`
**Status:** Design approved by owner; implementation plan next.

## 1. Goal

Refashion the all-encompassing "William D'Amato" platform into a single-purpose
**business-outreach tool**. The tool does exactly one job and nothing else:

> Source local businesses from Google Maps → find a real email (cheaply, first)
> → audit + score the website → if the site scores above an adjustable threshold,
> write a short personalized email → push the lead + email to **Instantly** for
> automated sending.

The owner personally handles everything after the push (replies, follow-ups,
booked calls, payment). William does **zero** inbound processing.

## 2. Non-goals (explicitly scrapped)

These existing subsystems are deleted on this branch:

- Follow-up & close-out automation (`outreach.followup`, `outreach.close`).
- Website building: `packages/templates`, `workers/site-builder`, WebsiteBriefs,
  `brief.generate`, `site.ship`, preview/revise/deploy, delivery email.
- Billing / Stripe (`workers/billing`, Stripe adapter, invoice drafts, payment
  webhooks).
- Calendar / scheduling (`workers/scheduling`).
- **All inbound reply processing**: the Instantly reply poller, reply
  classification, opportunity creation, transcript ingestion. The owner reads and
  responds to every reply inside Instantly.
- Experiments engine and weekly reports.
- Vercel and Gmail adapters (Instantly is the only outbound channel).

## 3. What is kept (the framework that works)

- **Google Places (New `/v1`) sourcing** + business cap + the `SourcingRun`
  entity and `lead.source` controller.
- **Playwright audit** (`workers/site-auditor`) — screenshots, Lighthouse, axe,
  heuristics — but only invoked *after* an email is found (see §5).
- **Scoring framework**: `scoreLead` + visual scoring (`llm.scoreVisualDesign`).
  Direction unchanged: a higher score = a worse site = a better prospect.
- **Email discovery / ranking**: `bestBusinessEmail`, `isPlaceholderEmail`,
  `crawlForEmail`, the placeholder/suffix blacklists.
- **SQLite store + durable queue** (`packages/db`), the API (`apps/api`), and a
  **trimmed** React dashboard (`apps/dashboard`).
- **Safety rails (invariants that still apply):**
  - DNC/unsubscribe are absolute — screened at intake, draft, and push.
  - `local` env = dry-run always; live needs granted approval + matching creds.
  - Side effects require a PolicyTicket (the Instantly push is gated).
  - Inbound/scraped text is DATA — never placed in an LLM prompt as instructions.
  - The opt-out line is compliance text and `validateDraft` enforces its
    presence.

## 4. Two easy-to-find settings

Defined at the top of `RuntimeConfig` / a clearly named constants module,
env-overridable. Defaults chosen so the owner vets the first ~50 leads before
going hands-off:

```ts
OUTREACH_SCORE_THRESHOLD = 45          // env: OUTREACH_SCORE_THRESHOLD
//   Only sites scoring ABOVE this are emailed. Higher score = worse site =
//   better prospect. (Supersedes today's hard-coded `score > 35` qualified rule.)

PUSH_MODE: "review" | "auto" = "review" // env: PUSH_MODE
//   "review" → qualified leads wait in the dashboard; owner clicks Approve & push.
//   "auto"   → qualified leads push to Instantly automatically (DNC still screened).
```

Both must be trivial to find and change. `OUTREACH_SCORE_THRESHOLD` replaces the
`countQualified` `score > 35` literal everywhere it gates "qualified".

## 5. Pipeline reorder — no audit without an email

**Today:** `lead.audit → lead.contact → lead.score → outreach.draft`, with the
cheap homepage email-grab fused *inside* the heavy audit.

**New:** `lead.source → lead.contact → lead.audit → lead.score → outreach.draft
→ outreach.push`, where:

1. **`lead.contact` (cheap email discovery, runs FIRST):** a new lightweight step
   that does a plain HTTP GET of the homepage HTML, regex-extracts and ranks
   emails (`bestBusinessEmail`), and falls back to `crawlForEmail` (subpage
   crawl) on a miss. **No browser rendering, no screenshots, no Lighthouse, no
   visual scoring.** If no real email is found → lead status `disqualified`, an
   OwnerRequest is raised (blocked ≠ stuck), and **no audit is enqueued**.
2. **`lead.audit`:** only enqueued when an email was found. Full Playwright audit
   (screenshots, Lighthouse, axe, heuristics) — the expensive work now only runs
   on emailable leads.
3. **`lead.score`:** `scoreLead` (+ visual scoring from the audit screenshots).
4. **Gate:** if `score <= OUTREACH_SCORE_THRESHOLD` → stop (lead kept, not
   emailed). If `score > threshold` → enqueue `outreach.draft`.
5. **`outreach.draft`:** William writes the full email (§6).
6. **`outreach.push`:** `PUSH_MODE`-dependent (§7).

> Implementation note: the homepage HTTP fetch + extraction logic that currently
> lives inside the audit's `extracted.contactEmails` must be factored into a
> standalone cheap step so it runs without the browser. `crawlForEmail` already
> uses Playwright; keep it as the second rung (still cheaper than a full audit)
> and dry-run-safe as today.

## 6. The email (William writes the whole thing)

All rules live in our code (not split into Instantly). Enforced by
`validateDraft`:

- **≤5 sentences** in the body (excluding greeting, P.S., and sign-off).
- **No emdashes** (and no other AI tells: no "I hope this finds you well", no
  "elevate/leverage/seamless", etc.).
- Friendly-professional **Cornell-student** voice — sounds like a real person, not
  a sales manager or a corporate entity.
- **Friendly P.S. opt-out**, using a comma (not an emdash). This replaces the old
  formal `OPT_OUT_LINE`; it remains compliance text whose presence `validateDraft`
  enforces.
- **No URL** in the email (the prospect's site / any link is revealed only after
  they reply).
- Keeps the free-mockup hook (the owner-specified "I put together a quick mockup"
  offer).
- The site-specific finding comes from the existing `deriveFindings` (plain
  language), fenced as untrusted DATA when it reaches the LLM.

**Approved sample:**

> **Subject:** quick note about Joe's Coffee's website
>
> Dear Joe,
>
> I'm Will, a student at Cornell, and I came across Joe's Coffee while looking at
> Austin coffee shops. I noticed your site takes a few seconds to load on phones
> and there's no easy spot for people to see your hours or order, which probably
> costs you a few walk-ins. I actually put together a quick mockup of how it could
> look, and I'd be happy to send it over if you want a peek. Either way, no worries
> at all if now's not a good time.
>
> Thanks,
> Will
>
> P.S. If you'd rather not hear from me, just say the word and I'll take you off my
> list right away, no hard feelings!

**Instantly hand-off:** William pushes the lead with custom variables
`first_name`, `company`, `email_subject`, `email_body`. The owner's Instantly
campaign template is just `{{email_subject}}` / `{{email_body}}`. (Operational:
the owner wires the campaign template to those variables; exact field names are
documented at hand-off.)

## 7. Push modes

- **`review` (default):** a qualified lead's drafted email lands in the dashboard
  as "ready". The owner clicks **Approve & push** (per lead) to push to Instantly.
  This is the existing `SEND_FIRST_TOUCH` gate / approval flow, repurposed.
- **`auto`:** a qualified lead is pushed to Instantly automatically after DNC
  screening. The dashboard becomes read-only monitoring.

DNC/unsubscribe screening is absolute in both modes. `local` env always dry-runs
the push regardless of mode.

## 8. Sourcing modes

- **Normal:** city + one niche + target N qualified; the `lead.source` controller
  stops once N leads clear the gate (existing behavior, threshold now 45).
- **Batch (new):** city + **multi-niche sweep** + business cap. The controller
  iterates the niche taxonomy (`NICHE_META`), issuing Places searches across
  business types, and processes every business found up to the business cap (no
  early stop on a qualified target). The Source-Leads form gets a
  "Batch (sweep all niches)" toggle + cap input. `SourcingRun` gains a `mode`
  field (`"normal" | "batch"`).

## 9. Dashboard (trimmed)

Two pages only; all other nav removed (Website Briefs, Site Projects, Billing,
Experiments, Weekly Reports, Deployments, etc.):

- **Source Leads:** form (city; niche dropdown OR "Batch — sweep all niches"
  toggle; target count / business cap) → live runs list (status, candidates,
  qualified count).
- **Leads:** table (company, email, score, status). In `review` mode each ready
  lead expands to show its drafted email inline with **Approve & push / Reject**
  (existing gated decide route). In `auto` mode the table is read-only monitoring.

## 10. Build approach

- All work on branch `outreach-tool`; `main` stays the frozen old version until
  the trim is done, then `outreach-tool` becomes the new main (old version in git
  history).
- **Subagent-driven**, **TDD**, **mock-first** — the full vitest suite and a
  dry-run (`npm run demo` equivalent, or a trimmed demo) pass with **zero
  credentials**. `.env` is never read.
- `compliance-reviewer` (read-only) must review the email-content changes and the
  push path before those commits land.
- Scrapped workers/packages are deleted in focused, individually-green commits so
  the branch never goes red.
- **Final commit:** rewrite `CLAUDE.md`, `README.md`, and `handoff.md` to describe
  the outreach-only tool — keep the still-applicable invariants (DNC absolute,
  local = dry-run, side-effects gated, text-is-data) and the **Powell** canary;
  add a short "what the pivot scrapped" note for history.

## 11. Open operational items (not blockers, documented at hand-off)

- Owner wires the Instantly campaign template to `{{email_subject}}` /
  `{{email_body}}` custom variables.
- The real Places + Instantly + Anthropic paths still run only in staging/live
  (local = dry-run). The mandatory activation-time `compliance-reviewer` re-review
  of the live text→/image→prompt behavior still applies before the first real send.
