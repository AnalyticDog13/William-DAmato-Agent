# Automatic lead sourcing — design

**Date:** 2026-06-21
**Status:** approved design (pre-implementation)
**Goal:** William automatically finds qualified leads by city + niche (Google
Places), instead of the owner hand-entering each one. A one-click batch sources
until N leads qualify, then stops — with a hard candidate cap so spend is bounded.

## Problem

Today leads only enter via `ingestLead` (dashboard / CSV / seed). A
`PlacesAdapter.searchBusinesses` interface and an `ACTIVATE_NEW_LEAD_SOURCE`
policy gate exist, but the adapter is mock-only and **nothing in the pipeline
ever calls it**. Sourcing is therefore 100% manual. Once a lead is ingested, the
pipeline already auto-qualifies it (audit → email-find → score → draft).

## Requirements (owner-locked)

- **Trigger:** one-click batch. The owner enters `location`, `niche`, and a
  `target` count (how many qualified leads to find), optionally a candidate cap.
- **"Qualified" =** a lead that reached a **drafted email** (`draft_ready`, i.e. a
  real email was found AND it scored high enough to draft) **AND** whose latest
  score is **> 35/100**.
- **Stop conditions:** target met, OR a **candidate cap** is hit (default 40),
  OR Google Places runs out of results. On a cap/exhaust stop, report "found X
  of N".
- **Bounded spend:** the candidate cap is the cost ceiling — never a surprise bill.
- **Gated:** every run requires a granted `ACTIVATE_NEW_LEAD_SOURCE` approval.
- **Expanded niches:** add ~30 profitable local-business niches (med spas, etc.).
- **No phone collection:** do not request or store phone numbers from sourcing.
- **Mock-first:** suite + demo stay green with zero credentials; local never
  sources live (dry-run forces empty results).

## Architecture (Approach A — self-re-enqueuing controller)

`ingestLead` starts an **async** pipeline (audit → contact → score → draft are
separate queue jobs, 30s–2min each in real mode). So the controller cannot
synchronously know how many qualified. Instead a single `lead.source` job
sources a page, lets the leads flow through the normal pipeline, then
**re-enqueues itself** to re-count — repeating until a stop condition. This
matches the existing queue+record pattern, keeps sourcing isolated from the core
pipeline, and the candidate cap makes the cost ceiling provable.

### §1 — Real Google Places adapter

`packages/integrations/src/real/places.ts` → `createPlacesAdapter(deps, log)`.

- **Endpoint:** Places API **(New)**, `POST https://places.googleapis.com/v1/places:searchText`
  (there is no "v2"; the new API is served under `/v1/`; the legacy
  `maps.googleapis.com/maps/api/place/...` API is NOT used).
- **Headers:** `X-Goog-Api-Key: <GOOGLE_MAPS_API_KEY>`, `Content-Type: application/json`,
  **field mask** `places.displayName,places.websiteUri,places.formattedAddress,places.location,places.rating,nextPageToken`.
  **Phone is intentionally excluded** from the mask (owner does not collect phone;
  also a cheaper SKU).
- **Body:** `{ textQuery: "<niche searchTerm> in <location>", pageSize: 20, pageToken? }`.
- **Mapping:** each place → `DiscoveredBusiness { name, niche (set from the
  searched niche), websiteUrl, phone: null, address, city, rating }`.
- **Return shape:** the adapter is extended to return
  `{ businesses: DiscoveredBusiness[]; nextPageToken: string | null }` so the
  controller can paginate. (Interface + mock updated; nothing in production calls
  the old signature yet.)
- **Safety:** returns `{ businesses: [], nextPageToken: null }` under
  `ticket.dryRun` (local = zero network) and **fail-closed empty** on any HTTP
  error (never crashes the run).
- **Selection:** wired in `createIntegrations` by `GOOGLE_MAPS_API_KEY` presence;
  the mock stays the fallback. Local always dry-run → sourcing only does real
  work in staging/production with the key.

### §2 — `SourcingRun` entity

`packages/core/src/schema/sourcing.ts` (zod) → `store.sourcingRuns` repo →
`sourcing-runs` collection whitelist in `apps/api/src/server.ts` → dashboard.

```
SourcingRun {
  id, createdAt, updatedAt,
  location: string,
  niche: Niche,
  target: number,            // qualified leads wanted
  candidateCap: number,      // max leads ingested before giving up (default 40)
  status: "pending_approval" | "running" | "completed"
        | "stopped_cap" | "stopped_exhausted" | "failed",
  candidatesIngested: number,// leads CREATED by this run (dupes/blocked excluded)
  qualifiedCount: number,    // recomputed each check
  leadIds: string[],         // leads created by this run
  nextPageToken: string | null,
  checks: number,            // re-check count (bounds the poll loop)
  approvalRequestId: string | null,
  resultNote: string | null,
  traceId: string,
}
```

The record IS the progress tracker the dashboard reads.

### §3 — `lead.source` controller job (`handleLeadSource`)

Per invocation:

1. Load the run; if `status !== "running"`, return.
2. **Recompute `qualifiedCount`:** among `leadIds`, count leads that have an
   outreach draft (status `pending_approval`/`sent`/`sent_dry_run`) **and** a
   latest `LeadScore.score > 35`. Persist the count.
3. If `qualifiedCount >= target` → `status = "completed"`, note, **stop**.
4. If `candidatesIngested >= candidateCap` → `status = "stopped_cap"`, note
   "found {qualifiedCount} of {target}", **stop**.
5. If leads from the last page are **still mid-pipeline** (not yet terminal:
   `draft_ready` / `contacted` / `disqualified` / `do_not_contact` / etc.) →
   re-enqueue self on a delay and **wait** (don't over-source).
6. Else **fetch the next Places page** (gated ticket, `nextPageToken`), `ingestLead`
   up to `min(pageSize, candidateCap − candidatesIngested)` NEW businesses, update
   `candidatesIngested` / `leadIds` / `nextPageToken`, re-enqueue to re-check.
   - No businesses / no token returned → `status = "stopped_exhausted"`, note partial.
7. **Loop bound:** `checks` (or a wall-clock budget) caps the polling; if exceeded
   while leads are stuck → `status = "failed"` with a note (in-flight leads are
   kept, never deleted).

Re-enqueue delay is config-driven (default ~30s). Dedupe/blocked intake results
(`ingestLead` returns `duplicate`/`blocked`) do **not** count toward
`candidatesIngested` or `leadIds`.

### §4 — Trigger, API, gating, dashboard

- `POST /api/sourcing-runs { location, niche, target, candidateCap? }` → creates a
  `SourcingRun` (`pending_approval`) **and** an `ACTIVATE_NEW_LEAD_SOURCE` approval
  whose subject is the run. Returns both.
- Owner grants the approval in the **Review Queue** (existing flow). The decide
  route, when granting an `ACTIVATE_NEW_LEAD_SOURCE` approval whose subject is a
  `SourcingRun`, sets the run `running` and enqueues `lead.source { sourcingRunId }`.
- `handleLeadSource` re-evaluates the gate (`evaluateGate`,
  subject = run, integration `google_maps`) to mint each Places ticket — so
  nothing searches without a granted approval. The approval stays granted for the
  run's duration (verify granted approvals are not single-use; if they are,
  authorize the run once and use operational tickets carrying the `google_maps`
  credential for subsequent pages).
- `GET /api/sourcing-runs` lists runs + live progress.
- **Dashboard:** a "Source leads" form (location text, niche dropdown, count,
  optional cap) + a runs list showing `status`, `candidatesIngested`,
  `qualifiedCount`, `resultNote`.

### §5 — Niche expansion (single source of truth)

Introduce `NICHE_META` in `@william/core`: `Record<Niche, { label, searchTerm,
outreachHook }>`. Derive the `Niche` zod enum from its keys, the outreach
`NICHE_HOOKS` (draft.ts) from `outreachHook`, and the Places query from
`searchTerm`. This removes the current duplication between the enum and the hooks.

Niches (existing + new): barbershop, coffee_shop, restaurant, fashion,
photographer, **med_spa, dental, chiropractor, law_firm, real_estate, hvac,
plumbing, electrician, landscaping, gym, yoga_pilates, hair_salon, nail_salon,
day_spa, auto_repair, roofing, painter, cleaning, veterinary, accounting,
insurance, pest_control, bakery, florist, jeweler, optometry, dermatology,
physical_therapy, tattoo, event_venue, interior_design, daycare, pet_grooming**,
other. Each gets a tailored, plain-language hook; unknown niches fall back to the
generic hook (`other`). Additive only — existing leads/niches stay valid.

### §6 — The "20–35" byproduct (decided)

A lead scoring 20–35 is not `skip`, so the existing pipeline still **drafts** it;
it simply does **not** count toward the run's target (target counts `> 35` only).
**Decision:** leave the global pipeline unchanged — these sub-35 drafts are still
real, valid leads the owner can choose to send or ignore. (We do NOT add a
sourcing-specific draft threshold; least invasive, no special-casing in the core
pipeline.)

### §7 — Error handling

- Places HTTP error → fail-closed empty page; bounded retries then
  `stopped_exhausted` with a note.
- Stuck lead (never reaches terminal) → bounded by the check/runtime cap →
  `failed` with a note; in-flight leads are kept.
- Duplicate / DNC-blocked businesses → not counted toward the cap or `leadIds`.
- Local / dry-run → Places returns empty → run `completes` with 0 qualified (local
  cannot source live, by design / invariant 3).

## Testing (mock-first; suite + demo green with zero keys)

- Mock Places returns paged businesses (mix of has-email / no-email, varying
  mock-audit scores) with a `nextPageToken` chain.
- Controller, driven via `runUntilEmpty` + mock audit + fake browser:
  - stops **exactly** at target (counts only `draft_ready` & score > 35);
  - **stopped_cap** partial when the cap is hit first;
  - **stopped_exhausted** when Places runs out;
  - **gating** — no sourcing without a granted `ACTIVATE_NEW_LEAD_SOURCE`;
  - **dedup** — duplicate businesses don't double-count.
- Real Places adapter unit test with injected `fetchImpl`: v1 `searchText` request
  shape (URL, headers, field mask **without phone**, body), response → `DiscoveredBusiness`
  mapping + `nextPageToken`, and **dry-run → empty** (zero network).
- Niche registry: `Niche` enum derived from `NICHE_META`; every niche has a hook
  + search term.

## Defaults

- `candidateCap` default **40** (configurable per run + a `RuntimeConfig` default).
- Re-check delay default ~**30s** (config).
- `pageSize` 20 (Places max).

## Out of scope (future)

- Autopilot top-up (auto-maintain N qualified) — build on this controller later.
- Enrichment/verify provider for no-email leads (separate work).
- Deeper email discovery (mailto/JSON-LD/Cloudflare) — separate work that would
  raise the sourcing hit-rate.
