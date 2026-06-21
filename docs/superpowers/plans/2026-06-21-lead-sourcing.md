# Automatic Lead Sourcing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** William automatically sources qualified leads by city + niche from Google Places (one-click batch, stops at a target, bounded by a candidate cap), instead of the owner hand-entering each lead.

**Architecture:** A real Google Places (New, `/v1`) adapter feeds a self-re-enqueuing `lead.source` controller job that ingests candidates through the existing audit→contact→score→draft pipeline, re-checks how many qualified, and stops at target / candidate-cap / Places-exhausted. A `SourcingRun` record tracks progress; the whole run is gated by `ACTIVATE_NEW_LEAD_SOURCE`.

**Tech Stack:** TypeScript (strict, `moduleResolution: Bundler`), zod schemas, SQLite Store + durable job queue, vitest, Express API, React/Vite dashboard. Everything runs via tsx/vite.

**Spec:** `docs/superpowers/specs/2026-06-21-lead-sourcing-design.md`.

## Global Constraints

- **local env = dry-run, always** (invariant 3). The real Places adapter MUST return empty under `ticket.dryRun`; sourcing only does real work in staging/production with `GOOGLE_MAPS_API_KEY`.
- **Side effects require a PolicyTicket** (invariant 2). Places search runs under a ticket; the run is gated by the `ACTIVATE_NEW_LEAD_SOURCE` approval.
- **Mock-first:** `npm test` and `npm run demo` MUST stay green with zero credentials. The mock Places adapter is the fallback.
- **Qualified =** a lead with an `OutreachDraft` (reached `draft_ready` or beyond) AND latest `LeadScore.score > 35`.
- **Candidate cap default = 40.** Re-check delay default ~30000 ms. Places `pageSize = 20`.
- **No phone collection** from sourcing: omit phone from the Places field mask; set `phone: null` on sourced businesses.
- **Workspace imports only** (`@william/core`, etc.); no deep relative cross-package imports.
- **Every test command:** run from repo root. Full suite: `npm test`. Single file: `npx vitest run <path>`. Typecheck: `npm run typecheck`.
- Commit after each task. Branch is `main` (repo is trunk-based); commit directly.

## File Structure

- `packages/core/src/schema/common.ts` — **modify**: expand the `Niche` enum.
- `packages/core/src/niche.ts` — **create**: `NICHE_META` registry (`label`, `searchTerm`, `outreachHook`) keyed by `Niche`; helper `nicheSearchQuery`.
- `packages/core/src/schema/sourcing.ts` — **create**: `SourcingRun` zod schema.
- `packages/core/src/index.ts` — **modify**: export `niche.ts` + `schema/sourcing.ts`.
- `workers/outreach/src/draft.ts` — **modify**: `NICHE_HOOKS` derives from `NICHE_META`.
- `packages/integrations/src/types.ts` — **modify**: `PlacesAdapter.searchBusinesses` signature + return shape.
- `packages/integrations/src/mocks.ts` — **modify**: mock Places returns the new shape with pagination.
- `packages/integrations/src/real/places.ts` — **create**: real Places (New `/v1`) adapter.
- `packages/integrations/src/registry.ts` — **modify**: select real Places by `GOOGLE_MAPS_API_KEY`.
- `packages/db/src/store.ts` — **modify**: `sourcingRuns` repository.
- `workers/orchestrator/src/sourcing.ts` — **create**: `countQualified`, `leadResolved`, run helpers.
- `workers/orchestrator/src/pipelines.ts` — **modify**: `handleLeadSource` + register `lead.source` in `JOB_HANDLERS`.
- `packages/core/src/env.ts` — **modify**: `RuntimeConfig.leadSourcing` defaults.
- `apps/api/src/server.ts` — **modify**: `sourcing-runs` whitelist, `POST`/`GET /api/sourcing-runs`, decide-route gate branch.
- `apps/dashboard/src/pages/SourcingPage.tsx` — **create**: source form + runs list. Plus nav wiring.
- `.env.example`, `docs/setup.md` — **modify**: document the new env knobs.

---

### Task 1: Expand niche taxonomy + `NICHE_META` registry

**Files:**
- Modify: `packages/core/src/schema/common.ts:6-14`
- Create: `packages/core/src/niche.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `workers/outreach/src/draft.ts:14-21,50`
- Test: `packages/core/test/niche.test.ts`

**Interfaces:**
- Produces: `Niche` (expanded enum), `NICHE_META: Record<Niche, { label: string; searchTerm: string; outreachHook: string }>`, `nicheSearchQuery(niche: Niche, location: string): string`.

- [ ] **Step 1: Write the failing test** — `packages/core/test/niche.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { Niche, NICHE_META, nicheSearchQuery } from "../src";

describe("niche registry", () => {
  it("every Niche value has metadata (exhaustive)", () => {
    for (const n of Niche.options) {
      const meta = NICHE_META[n];
      expect(meta, n).toBeDefined();
      expect(meta.searchTerm.length, n).toBeGreaterThan(0);
      expect(meta.outreachHook.length, n).toBeGreaterThan(0);
    }
  });
  it("includes the new profitable niches", () => {
    for (const n of ["med_spa", "dental", "law_firm", "hvac", "real_estate"]) {
      expect(Niche.options).toContain(n);
    }
  });
  it("builds a Places text query", () => {
    expect(nicheSearchQuery("med_spa", "Austin, TX")).toBe("med spas in Austin, TX");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/niche.test.ts`
Expected: FAIL (`NICHE_META`/`nicheSearchQuery` not exported; new niches absent).

- [ ] **Step 3: Expand the `Niche` enum** in `packages/core/src/schema/common.ts` — replace the enum body (keep `export type Niche`):

```ts
export const Niche = z.enum([
  "barbershop", "fashion", "photographer", "coffee_shop", "restaurant",
  "med_spa", "dental", "chiropractor", "law_firm", "real_estate",
  "hvac", "plumbing", "electrician", "landscaping", "gym",
  "yoga_pilates", "hair_salon", "nail_salon", "day_spa", "auto_repair",
  "roofing", "painter", "cleaning", "veterinary", "accounting",
  "insurance", "pest_control", "bakery", "florist", "jeweler",
  "optometry", "dermatology", "physical_therapy", "tattoo", "event_venue",
  "interior_design", "daycare", "pet_grooming",
  "other",
]);
```

- [ ] **Step 4: Create `packages/core/src/niche.ts`**

```ts
import type { Niche } from "./schema/common";

export interface NicheMeta {
  /** Human label for the dashboard. */
  label: string;
  /** Plural noun used to build the Places text query, e.g. "med spas". */
  searchTerm: string;
  /** Plain-language outreach hook ("I help <niche> ..."). */
  outreachHook: string;
}

/** Single source of truth for niche labels, Places search terms, and outreach hooks.
 *  `Record<Niche, ...>` makes this exhaustive — a new Niche won't compile without metadata. */
export const NICHE_META: Record<Niche, NicheMeta> = {
  barbershop: { label: "Barbershop", searchTerm: "barbershops", outreachHook: "I help barbershops get found and booked online" },
  fashion: { label: "Fashion brand", searchTerm: "fashion boutiques", outreachHook: "I help fashion brands look as sharp online as their pieces do" },
  photographer: { label: "Photographer", searchTerm: "photographers", outreachHook: "I help photographers turn portfolios into inquiries" },
  coffee_shop: { label: "Coffee shop", searchTerm: "coffee shops", outreachHook: "I help coffee shops turn foot traffic into regulars" },
  restaurant: { label: "Restaurant", searchTerm: "restaurants", outreachHook: "I help restaurants fill more tables from search" },
  med_spa: { label: "Med spa", searchTerm: "med spas", outreachHook: "I help med spas turn website visitors into booked treatments" },
  dental: { label: "Dental practice", searchTerm: "dentists", outreachHook: "I help dental practices win new patients online" },
  chiropractor: { label: "Chiropractor", searchTerm: "chiropractors", outreachHook: "I help chiropractors get more new-patient bookings" },
  law_firm: { label: "Law firm", searchTerm: "law firms", outreachHook: "I help law firms turn searches into consultations" },
  real_estate: { label: "Real estate", searchTerm: "real estate agents", outreachHook: "I help real estate agents turn listings into leads" },
  hvac: { label: "HVAC", searchTerm: "HVAC companies", outreachHook: "I help HVAC companies book more service calls online" },
  plumbing: { label: "Plumber", searchTerm: "plumbers", outreachHook: "I help plumbers get found and called first" },
  electrician: { label: "Electrician", searchTerm: "electricians", outreachHook: "I help electricians turn searches into jobs" },
  landscaping: { label: "Landscaping", searchTerm: "landscapers", outreachHook: "I help landscapers book more seasonal work online" },
  gym: { label: "Gym / fitness", searchTerm: "gyms", outreachHook: "I help gyms turn website visitors into members" },
  yoga_pilates: { label: "Yoga / Pilates", searchTerm: "yoga and pilates studios", outreachHook: "I help studios fill more classes from search" },
  hair_salon: { label: "Hair salon", searchTerm: "hair salons", outreachHook: "I help hair salons get found and booked online" },
  nail_salon: { label: "Nail salon", searchTerm: "nail salons", outreachHook: "I help nail salons turn searches into bookings" },
  day_spa: { label: "Day spa", searchTerm: "day spas", outreachHook: "I help spas turn website visits into bookings" },
  auto_repair: { label: "Auto repair", searchTerm: "auto repair shops", outreachHook: "I help auto shops get found and booked online" },
  roofing: { label: "Roofing", searchTerm: "roofing companies", outreachHook: "I help roofers turn searches into estimates" },
  painter: { label: "Painter", searchTerm: "painting contractors", outreachHook: "I help painters book more jobs from their website" },
  cleaning: { label: "Cleaning service", searchTerm: "cleaning services", outreachHook: "I help cleaning services turn searches into recurring clients" },
  veterinary: { label: "Veterinary", searchTerm: "veterinary clinics", outreachHook: "I help vet clinics win new clients online" },
  accounting: { label: "Accounting / CPA", searchTerm: "accountants", outreachHook: "I help accounting firms turn searches into clients" },
  insurance: { label: "Insurance agency", searchTerm: "insurance agencies", outreachHook: "I help insurance agencies turn searches into quotes" },
  pest_control: { label: "Pest control", searchTerm: "pest control companies", outreachHook: "I help pest control companies book more jobs online" },
  bakery: { label: "Bakery", searchTerm: "bakeries", outreachHook: "I help bakeries turn foot traffic and search into orders" },
  florist: { label: "Florist", searchTerm: "florists", outreachHook: "I help florists turn online searches into orders" },
  jeweler: { label: "Jeweler", searchTerm: "jewelers", outreachHook: "I help jewelers turn online interest into visits" },
  optometry: { label: "Optometry", searchTerm: "optometrists", outreachHook: "I help eye-care practices win new patients online" },
  dermatology: { label: "Dermatology", searchTerm: "dermatology clinics", outreachHook: "I help dermatology clinics turn searches into appointments" },
  physical_therapy: { label: "Physical therapy", searchTerm: "physical therapy clinics", outreachHook: "I help PT clinics get more new-patient bookings" },
  tattoo: { label: "Tattoo studio", searchTerm: "tattoo studios", outreachHook: "I help tattoo studios turn their portfolio into bookings" },
  event_venue: { label: "Event venue", searchTerm: "event venues", outreachHook: "I help event venues turn searches into tours and bookings" },
  interior_design: { label: "Interior design", searchTerm: "interior designers", outreachHook: "I help interior designers turn their portfolio into inquiries" },
  daycare: { label: "Daycare / preschool", searchTerm: "daycares", outreachHook: "I help daycares turn searches into enrollments" },
  pet_grooming: { label: "Pet grooming", searchTerm: "pet groomers", outreachHook: "I help pet groomers get found and booked online" },
  other: { label: "Other local business", searchTerm: "local businesses", outreachHook: "I help local businesses win more customers online" },
};

/** Places text query, e.g. nicheSearchQuery("med_spa", "Austin, TX") => "med spas in Austin, TX". */
export function nicheSearchQuery(niche: Niche, location: string): string {
  return `${NICHE_META[niche].searchTerm} in ${location}`;
}
```

- [ ] **Step 5: Export from core** — in `packages/core/src/index.ts` add (near the other schema exports):

```ts
export * from "./niche";
export * from "./schema/sourcing";
```

(The `schema/sourcing` export is created in Task 4; adding it now is harmless only if the file exists — if your tooling errors on the missing module, add that line in Task 4 instead.)

- [ ] **Step 6: Refactor `NICHE_HOOKS`** in `workers/outreach/src/draft.ts` — replace the literal map (lines 14-21) and its use (line 50):

```ts
import { NICHE_META } from "@william/core";
// ...delete the old NICHE_HOOKS object...
// at line 50, replace `const hook = NICHE_HOOKS[lead.niche] ?? NICHE_HOOKS.other!;` with:
const hook = NICHE_META[lead.niche].outreachHook;
```

- [ ] **Step 7: Verify `selectTemplate` tolerates new niches** — open `packages/templates/src/registry.ts:101`. If it switches on niche without a default, add a `default:` branch returning the same template it returns for `"other"`. (The self-builder is off by default, but keep it compiling.)

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run packages/core/test/niche.test.ts workers/outreach/test/draft.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(core): expand niche taxonomy + NICHE_META registry"
```

---

### Task 2: Paginate the `PlacesAdapter` interface + update the mock

**Files:**
- Modify: `packages/integrations/src/types.ts:101-117`
- Modify: `packages/integrations/src/mocks.ts:166-176`
- Test: `packages/integrations/test/places.test.ts`

**Interfaces:**
- Produces: `PlacesSearchInput = { query: string; location: string; pageToken?: string | null }`, `PlacesSearchResult = { businesses: DiscoveredBusiness[]; nextPageToken: string | null }`, `PlacesAdapter.searchBusinesses(ticket, input: PlacesSearchInput): Promise<PlacesSearchResult>`.

- [ ] **Step 1: Write the failing test** — `packages/integrations/test/places.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createLogger, type PolicyTicket } from "@william/core";
import { createMockPlaces } from "../src/mocks";

const log = createLogger({ app: "test" }, () => {});
const ticket = { id: "t", dryRun: false } as unknown as PolicyTicket;

describe("mock places adapter (new shape)", () => {
  it("returns { businesses, nextPageToken }", async () => {
    const places = createMockPlaces();
    const res = await places.searchBusinesses(ticket, { query: "coffee shops in Ithaca, NY", location: "Ithaca, NY" });
    expect(Array.isArray(res.businesses)).toBe(true);
    expect(res).toHaveProperty("nextPageToken");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/integrations/test/places.test.ts`
Expected: FAIL (mock returns an array, not `{ businesses, nextPageToken }`).

- [ ] **Step 3: Update the interface** in `packages/integrations/src/types.ts` — replace the `PlacesAdapter` block (around 111-117):

```ts
export interface PlacesSearchInput {
  query: string;
  location: string;
  pageToken?: string | null;
}

export interface PlacesSearchResult {
  businesses: DiscoveredBusiness[];
  nextPageToken: string | null;
}

export interface PlacesAdapter {
  readonly name: string;
  searchBusinesses(ticket: PolicyTicket, input: PlacesSearchInput): Promise<PlacesSearchResult>;
}
```

- [ ] **Step 4: Update the mock** in `packages/integrations/src/mocks.ts` (replace `createMockPlaces`, ~166-176):

```ts
export function createMockPlaces(): PlacesAdapter {
  return {
    name: "mock-google-maps",
    async searchBusinesses(ticket, input) {
      requireTicket(ticket, "places.searchBusinesses");
      // Page 1 returns the canned businesses; no further pages.
      const businesses = input.pageToken ? [] : MOCK_BUSINESSES.map((b) => ({ ...b, phone: null }));
      return { businesses, nextPageToken: null };
    },
  };
}
```

(If `MOCK_BUSINESSES` entries are typed as `DiscoveredBusiness`, `phone: null` is already valid. Import `PlacesAdapter` is already present.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/integrations/test/places.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(integrations): paginate PlacesAdapter + drop sourced phone"
```

---

### Task 3: Real Google Places (New `/v1`) adapter

**Files:**
- Create: `packages/integrations/src/real/places.ts`
- Modify: `packages/integrations/src/registry.ts:89-103`
- Test: `packages/integrations/test/places.test.ts` (append)

**Interfaces:**
- Consumes: `RealDeps` (`{ env, fetchImpl? }`), `PolicyTicket`, `PlacesSearchInput`, `PlacesSearchResult`, `DiscoveredBusiness`.
- Produces: `createPlacesAdapter(deps: RealDeps, log: Logger): PlacesAdapter`.

- [ ] **Step 1: Write the failing tests** — append to `packages/integrations/test/places.test.ts`

```ts
import { createPlacesAdapter } from "../src/real/places";

const dryTicket = { id: "t", dryRun: true } as unknown as PolicyTicket;
const liveTicket = { id: "t", dryRun: false } as unknown as PolicyTicket;

describe("real places adapter (v1 searchText)", () => {
  it("returns empty under dry-run (zero network)", async () => {
    let called = false;
    const fetchImpl = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
    const places = createPlacesAdapter({ env: { GOOGLE_MAPS_API_KEY: "k" }, fetchImpl }, log);
    const res = await places.searchBusinesses(dryTicket, { query: "med spas in Austin, TX", location: "Austin, TX" });
    expect(called).toBe(false);
    expect(res).toEqual({ businesses: [], nextPageToken: null });
  });

  it("calls v1 searchText, maps results, drops phone, returns nextPageToken", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        places: [{
          displayName: { text: "Glow Med Spa" },
          websiteUri: "https://glowmedspa.com",
          formattedAddress: "1 Main St, Austin, TX",
          location: { latitude: 30.2, longitude: -97.7 },
          rating: 4.6,
          nationalPhoneNumber: "+1 512-555-0100",
        }],
        nextPageToken: "PAGE2",
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const places = createPlacesAdapter({ env: { GOOGLE_MAPS_API_KEY: "k" }, fetchImpl }, log);
    const res = await places.searchBusinesses(liveTicket, { query: "med spas in Austin, TX", location: "Austin, TX" });

    expect(calls[0]!.url).toBe("https://places.googleapis.com/v1/places:searchText");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("k");
    expect(headers["X-Goog-FieldMask"]).not.toContain("nationalPhoneNumber"); // phone NOT requested
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ textQuery: "med spas in Austin, TX", pageSize: 20 });
    expect(res.businesses[0]).toMatchObject({ name: "Glow Med Spa", websiteUrl: "https://glowmedspa.com", phone: null });
    expect(res.nextPageToken).toBe("PAGE2");
  });

  it("fail-closed empty on HTTP error", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const places = createPlacesAdapter({ env: { GOOGLE_MAPS_API_KEY: "k" }, fetchImpl }, log);
    const res = await places.searchBusinesses(liveTicket, { query: "x", location: "y" });
    expect(res).toEqual({ businesses: [], nextPageToken: null });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/integrations/test/places.test.ts`
Expected: FAIL (`createPlacesAdapter` not found).

- [ ] **Step 3: Implement `packages/integrations/src/real/places.ts`**

```ts
import type { Logger } from "@william/core";
import type { RealDeps } from "./shared";
import type { DiscoveredBusiness, PlacesAdapter, PlacesSearchResult } from "../types";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
// NOTE: phone (nationalPhoneNumber) deliberately omitted — we do not collect phone (and it is a pricier SKU).
const FIELD_MASK = [
  "places.displayName",
  "places.websiteUri",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "nextPageToken",
].join(",");

interface PlacesApiPlace {
  displayName?: { text?: string };
  websiteUri?: string;
  formattedAddress?: string;
  rating?: number;
}
interface PlacesApiResponse { places?: PlacesApiPlace[]; nextPageToken?: string }

/** Real Places API (New) Text Search. Simulates (empty) under dry-run; fail-closed empty on any error. */
export function createPlacesAdapter(deps: RealDeps, log: Logger): PlacesAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    name: "google-places-v1",
    async searchBusinesses(ticket, input) {
      const empty: PlacesSearchResult = { businesses: [], nextPageToken: null };
      if (ticket.dryRun) return empty; // invariant 3: local never hits the network
      try {
        const res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": deps.env.GOOGLE_MAPS_API_KEY ?? "",
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify({ textQuery: input.query, pageSize: 20, ...(input.pageToken ? { pageToken: input.pageToken } : {}) }),
        });
        if (!res.ok) {
          log.warn("places searchText failed; returning empty", { status: res.status });
          return empty;
        }
        const data = (await res.json()) as PlacesApiResponse;
        const businesses: DiscoveredBusiness[] = (data.places ?? []).map((p) => ({
          name: p.displayName?.text ?? "(unknown)",
          niche: "other", // caller overrides with the searched niche
          websiteUrl: p.websiteUri ?? null,
          phone: null, // never collected
          address: p.formattedAddress ?? null,
          city: null,
          rating: typeof p.rating === "number" ? p.rating : null,
        }));
        return { businesses, nextPageToken: data.nextPageToken ?? null };
      } catch (err) {
        log.warn("places searchText threw; returning empty", { error: err instanceof Error ? err.message : String(err) });
        return empty;
      }
    },
  };
}
```

- [ ] **Step 4: Wire selection** in `packages/integrations/src/registry.ts` — import and select by key. Add the import near the other `real/*` imports and replace `places: createMockPlaces(),` (line ~96):

```ts
import { createPlacesAdapter } from "./real/places";
// ...
places: env.GOOGLE_MAPS_API_KEY ? createPlacesAdapter(deps, log) : createMockPlaces(),
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run packages/integrations/test/places.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(integrations): real Google Places (New v1) adapter"
```

---

### Task 4: `SourcingRun` schema + Store repository + collection whitelist

**Files:**
- Create: `packages/core/src/schema/sourcing.ts`
- Modify: `packages/core/src/index.ts` (ensure `export * from "./schema/sourcing";`)
- Modify: `packages/db/src/store.ts` (declaration ~67 + repo init ~167)
- Modify: `apps/api/src/server.ts:42` (collection whitelist)
- Test: `packages/db/test/store.test.ts` (append a round-trip test)

**Interfaces:**
- Produces: `SourcingRun` type/schema; `store.sourcingRuns: Repository<SourcingRun>`; collection key `"sourcing-runs"`.

- [ ] **Step 1: Create `packages/core/src/schema/sourcing.ts`**

```ts
import { z } from "zod";
import { BaseEntity, Id, Niche } from "./common";

export const SourcingRunStatus = z.enum([
  "pending_approval", "running", "completed", "stopped_cap", "stopped_exhausted", "failed",
]);
export type SourcingRunStatus = z.infer<typeof SourcingRunStatus>;

export const SourcingRun = BaseEntity.extend({
  location: z.string(),
  niche: Niche,
  target: z.number().int().positive(),
  candidateCap: z.number().int().positive(),
  status: SourcingRunStatus,
  candidatesIngested: z.number().int().min(0).default(0),
  qualifiedCount: z.number().int().min(0).default(0),
  leadIds: z.array(Id).default([]),
  nextPageToken: z.string().nullable().default(null),
  checks: z.number().int().min(0).default(0),
  approvalRequestId: Id.nullable().default(null),
  resultNote: z.string().nullable().default(null),
  traceId: z.string(),
});
export type SourcingRun = z.infer<typeof SourcingRun>;
```

- [ ] **Step 2: Export it** — confirm `packages/core/src/index.ts` has `export * from "./schema/sourcing";` (add if missing).

- [ ] **Step 3: Add the repository** in `packages/db/src/store.ts` — add the import of `SourcingRun`, the readonly field near line 67, and the repo init near line 167 (mirror `websiteBriefs`):

```ts
// import: add SourcingRun to the @william/core import list
readonly sourcingRuns: Repository<SourcingRun>;
// in the constructor, after websiteBriefs:
this.sourcingRuns = repo<SourcingRun>({
  collection: "sourcing_runs",
  schema: SourcingRun,
  status: (r) => r.status,
});
```

- [ ] **Step 4: Whitelist the collection** in `apps/api/src/server.ts` near line 42:

```ts
"sourcing-runs": s.sourcingRuns,
```

- [ ] **Step 5: Write a round-trip test** — append to `packages/db/test/store.test.ts` (mirror an existing insert/get test):

```ts
it("persists and reads a SourcingRun", () => {
  const store = new Store(openMemoryDatabase());
  const now = nowIso();
  const run = store.sourcingRuns.insert({
    id: "src_1", createdAt: now, updatedAt: now,
    location: "Ithaca, NY", niche: "coffee_shop", target: 5, candidateCap: 40,
    status: "running", candidatesIngested: 0, qualifiedCount: 0, leadIds: [],
    nextPageToken: null, checks: 0, approvalRequestId: null, resultNote: null, traceId: "tr_1",
  });
  expect(store.sourcingRuns.get(run.id)?.status).toBe("running");
  expect(store.sourcingRuns.list({ status: "running" }).length).toBe(1);
});
```

(Match the existing imports at the top of `store.test.ts`; if `openMemoryDatabase`/`nowIso` aren't imported there, add them.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run packages/db/test/store.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(core,db): SourcingRun schema + repository"
```

---

### Task 5: `lead.source` controller job

**Files:**
- Create: `workers/orchestrator/src/sourcing.ts`
- Modify: `workers/orchestrator/src/pipelines.ts` (import helpers, add `handleLeadSource`, register `lead.source` in `JOB_HANDLERS` ~1396)
- Test: `workers/orchestrator/test/sourcing.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `Job`, `ingestLead`, `evaluateGate`, `nicheSearchQuery`, `SourcingRun`, `store.sourcingRuns`, `store.outreachDrafts`, `store.leadScores`, `store.leads`.
- Produces: `IN_FLIGHT_STATUSES: Set<LeadStatus>`, `leadResolved(lead): boolean`, `countQualified(ctx, leadIds, minScore): number`; `handleLeadSource: JobHandler`; job type `"lead.source"` with payload `{ sourcingRunId }`.

- [ ] **Step 1: Write the failing test** — `workers/orchestrator/test/sourcing.test.ts`. This drives the controller with a mock Places + mock audit through `runUntilEmpty`. Model it on the existing `pipeline.test.ts` setup (createContext, `runUntilEmpty`, `futureClock`).

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { newId, newTraceId, nowIso } from "@william/core";
import { createContext, type AppContext } from "../src/context";
import { JOB_HANDLERS } from "../src/pipelines";

// Reuse the harness helpers from pipeline.test.ts (copy runUntilEmpty + futureClock,
// or import them if they are exported). Keep this test in the same style.
declare function runUntilEmpty(ctx: AppContext, max: number, clock?: () => number): Promise<void>;
declare const futureClock: () => number;

function approvedRun(ctx: AppContext, target: number, cap: number) {
  const now = nowIso();
  const run = ctx.store.sourcingRuns.insert({
    id: newId("src"), createdAt: now, updatedAt: now,
    location: "Ithaca, NY", niche: "coffee_shop", target, candidateCap: cap,
    status: "running", candidatesIngested: 0, qualifiedCount: 0, leadIds: [],
    nextPageToken: null, checks: 0, approvalRequestId: "apr_x", resultNote: null, traceId: newTraceId(),
  });
  // Grant the gate so evaluateGate passes (mirror how other tests grant approvals).
  // ... insert a granted ACTIVATE_NEW_LEAD_SOURCE ApprovalRequest with subjectId = run.id ...
  return run;
}

describe("lead.source controller", () => {
  let ctx: AppContext;
  beforeEach(() => { ctx = createContext({ inMemory: true, silent: true }); });

  it("sources, ingests, and stops at target", async () => {
    // Mock Places returns 3 businesses with real-email-bearing domains (mock audit
    // synthesizes info@<domain> for bad<2), so they qualify.
    ctx.integrations.places.searchBusinesses = async () => ({
      businesses: [
        { name: "A Coffee", niche: "coffee_shop", websiteUrl: "https://a-coffee.example.com", phone: null, address: null, city: "Ithaca", rating: 4 },
        { name: "B Coffee", niche: "coffee_shop", websiteUrl: "https://b-coffee.example.com", phone: null, address: null, city: "Ithaca", rating: 4 },
      ],
      nextPageToken: null,
    });
    const run = approvedRun(ctx, 1, 40);
    ctx.store.queue.enqueue({ type: "lead.source", payload: { sourcingRunId: run.id }, traceId: run.traceId });
    await runUntilEmpty(ctx, 500, futureClock);
    const after = ctx.store.sourcingRuns.get(run.id)!;
    expect(["completed", "stopped_exhausted"]).toContain(after.status);
    expect(after.qualifiedCount).toBeGreaterThanOrEqual(1);
  });

  it("stops at the candidate cap with a partial note", async () => {
    ctx.integrations.places.searchBusinesses = async (_t, input) => input.pageToken
      ? { businesses: [], nextPageToken: null }
      : { businesses: [{ name: "C", niche: "coffee_shop", websiteUrl: "https://c.example.com", phone: null, address: null, city: "X", rating: 3 }], nextPageToken: null };
    const run = approvedRun(ctx, 5, 1); // cap 1, target 5 → can't reach target
    ctx.store.queue.enqueue({ type: "lead.source", payload: { sourcingRunId: run.id }, traceId: run.traceId });
    await runUntilEmpty(ctx, 500, futureClock);
    const after = ctx.store.sourcingRuns.get(run.id)!;
    expect(["stopped_cap", "stopped_exhausted"]).toContain(after.status);
    expect(after.resultNote ?? "").toMatch(/of 5/);
  });
});
```

> Implementer note: copy `runUntilEmpty` and `futureClock` from `workers/orchestrator/test/pipeline.test.ts` (top of file) rather than the `declare` stubs above, and replace the `approvedRun` approval-insert comment with a real granted `ApprovalRequest` insert (gate `ACTIVATE_NEW_LEAD_SOURCE`, subjectId = run.id, status `granted`) — mirror how `pipeline.test.ts` grants `DEPLOY_PRODUCTION`/`SEND_FIRST_TOUCH`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run workers/orchestrator/test/sourcing.test.ts`
Expected: FAIL (no `lead.source` handler).

- [ ] **Step 3: Create `workers/orchestrator/src/sourcing.ts`**

```ts
import type { Lead, LeadStatus } from "@william/core";
import type { AppContext } from "./context";

/** Statuses where a lead is still moving through audit→contact→score→draft. */
export const IN_FLIGHT_STATUSES: ReadonlySet<LeadStatus> = new Set<LeadStatus>([
  "new", "auditing", "audited", "scored", "contact_ready",
]);

export function leadResolved(lead: Lead): boolean {
  return !IN_FLIGHT_STATUSES.has(lead.status);
}

/** A lead is "qualified" when it produced an outreach draft AND its latest score exceeds minScore. */
export function countQualified(ctx: AppContext, leadIds: string[], minScore: number): number {
  let n = 0;
  for (const id of leadIds) {
    const hasDraft = ctx.store.outreachDrafts.list({ leadId: id }).length > 0;
    if (!hasDraft) continue;
    const score = ctx.store.leadScores.list({ leadId: id })[0]?.score ?? 0;
    if (score > minScore) n += 1;
  }
  return n;
}
```

- [ ] **Step 4: Add `handleLeadSource` to `workers/orchestrator/src/pipelines.ts`** (import the helpers + `nicheSearchQuery` + `ingestLead` is local; add near the other handlers):

```ts
import { nicheSearchQuery } from "@william/core";
import { IN_FLIGHT_STATUSES, countQualified, leadResolved } from "./sourcing";

const QUALIFIED_MIN_SCORE = 35;
const MAX_SOURCING_CHECKS = 300;

const handleLeadSource: JobHandler = async (ctx, job) => {
  const run = ctx.store.sourcingRuns.get(job.payload.sourcingRunId as string);
  if (!run || run.status !== "running") return;

  const reEnqueue = () =>
    ctx.store.queue.enqueue({
      type: "lead.source",
      payload: { sourcingRunId: run.id },
      traceId: job.traceId,
      delayMs: ctx.config.leadSourcing.recheckDelayMs,
    });
  const stop = (status: typeof run.status, note: string) =>
    ctx.store.sourcingRuns.save({ ...run, status, resultNote: note, updatedAt: nowIso() });

  // 1) recompute qualified
  const qualifiedCount = countQualified(ctx, run.leadIds, QUALIFIED_MIN_SCORE);
  const checks = run.checks + 1;
  ctx.store.sourcingRuns.save({ ...run, qualifiedCount, checks, updatedAt: nowIso() });

  if (qualifiedCount >= run.target) { stop("completed", `Found ${qualifiedCount} qualified lead(s).`); return; }
  if (run.candidatesIngested >= run.candidateCap) { stop("stopped_cap", `Hit candidate cap (${run.candidateCap}) — found ${qualifiedCount} of ${run.target}.`); return; }
  if (checks > MAX_SOURCING_CHECKS) { stop("failed", `Stopped after ${checks} checks — found ${qualifiedCount} of ${run.target}.`); return; }

  // 2) if last page's leads are still flowing, wait
  const inFlight = run.leadIds.some((id) => {
    const l = ctx.store.leads.get(id);
    return l ? !leadResolved(l) : false;
  });
  if (inFlight) { reEnqueue(); return; }

  // 3) source the next page (gated)
  const decision = evaluateGate(ctx, {
    gate: "ACTIVATE_NEW_LEAD_SOURCE",
    subjectType: "SourcingRun",
    subjectId: run.id,
    traceId: job.traceId,
  });
  if (!decision.allowed || !decision.ticket) { stop("failed", `Lead-source gate denied: ${decision.reason}`); return; }

  const page = await ctx.integrations.places.searchBusinesses(decision.ticket, {
    query: nicheSearchQuery(run.niche, run.location),
    location: run.location,
    pageToken: run.nextPageToken,
  });
  if (page.businesses.length === 0) { stop("stopped_exhausted", `No more results — found ${qualifiedCount} of ${run.target}.`); return; }

  const remaining = run.candidateCap - run.candidatesIngested;
  const newLeadIds: string[] = [];
  for (const biz of page.businesses.slice(0, remaining)) {
    const result = ingestLead(ctx, {
      companyName: biz.name,
      websiteUrl: biz.websiteUrl,
      niche: run.niche,
      city: biz.city,
      source: { kind: "google_maps", detail: `sourcing ${run.id}`, importedAt: nowIso(), importedBy: "system" },
    });
    if (result.outcome === "created") newLeadIds.push(result.lead.id);
  }

  ctx.store.sourcingRuns.save({
    ...run,
    leadIds: [...run.leadIds, ...newLeadIds],
    candidatesIngested: run.candidatesIngested + newLeadIds.length,
    nextPageToken: page.nextPageToken,
    checks,
    qualifiedCount,
    updatedAt: nowIso(),
  });
  reEnqueue();
};
```

- [ ] **Step 5: Register the handler** in the `JOB_HANDLERS` object (`pipelines.ts:1396`):

```ts
"lead.source": handleLeadSource,
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run workers/orchestrator/test/sourcing.test.ts && npm run typecheck`
Expected: PASS, clean. (`ctx.config.leadSourcing.recheckDelayMs` lands in Task 7; if running this task before Task 7, temporarily inline `30000` and replace it in Task 7.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(orchestrator): lead.source controller job"
```

---

### Task 6: API — create/list runs + decide-route gate branch

**Files:**
- Modify: `apps/api/src/server.ts` (add routes; extend the decide-route gate switch ~182-186)
- Test: `apps/api/test/server.test.ts` (append)

**Interfaces:**
- Consumes: `Niche`, `store.sourcingRuns`, the existing approval-creation pattern (mirror `POST /api/site-projects/:id/request-deploy`), `evaluateGate`.
- Produces: `POST /api/sourcing-runs`, `GET /api/sourcing-runs`, decide-route branch for `ACTIVATE_NEW_LEAD_SOURCE`.

- [ ] **Step 1: Write the failing test** — append to `apps/api/test/server.test.ts` (mirror existing authed-request helpers in that file):

```ts
it("POST /api/sourcing-runs creates a run + ACTIVATE_NEW_LEAD_SOURCE approval", async () => {
  const res = await authed("POST", "/api/sourcing-runs", { location: "Ithaca, NY", niche: "coffee_shop", target: 5 });
  expect(res.status).toBe(201);
  expect(res.body.run.status).toBe("pending_approval");
  expect(res.body.approval.gate).toBe("ACTIVATE_NEW_LEAD_SOURCE");
});

it("rejects an unknown niche", async () => {
  const res = await authed("POST", "/api/sourcing-runs", { location: "X", niche: "not_a_niche", target: 3 });
  expect(res.status).toBe(400);
});
```

(Use whatever the file's existing authed-request helper is called; match its signature.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/api/test/server.test.ts`
Expected: FAIL (route 404).

- [ ] **Step 3: Add the routes** in `apps/api/src/server.ts`. Mirror the approval creation used by `request-deploy`. Use `Niche.safeParse` like line 149.

```ts
// POST /api/sourcing-runs
app.post("/api/sourcing-runs", requireOwner, (req, res) => {
  const body = req.body ?? {};
  const niche = Niche.safeParse(body.niche);
  const target = Number(body.target);
  const location = typeof body.location === "string" ? body.location.trim() : "";
  if (!niche.success || !location || !Number.isInteger(target) || target <= 0) {
    return res.status(400).json({ error: "location, valid niche, and positive integer target required" });
  }
  const candidateCap = Number.isInteger(body.candidateCap) && body.candidateCap > 0
    ? body.candidateCap : ctx.config.leadSourcing.defaultCandidateCap;
  const now = nowIso();
  const traceId = newTraceId();
  const run = ctx.store.sourcingRuns.insert({
    id: newId("src"), createdAt: now, updatedAt: now,
    location, niche: niche.data, target, candidateCap,
    status: "pending_approval", candidatesIngested: 0, qualifiedCount: 0, leadIds: [],
    nextPageToken: null, checks: 0, approvalRequestId: null, resultNote: null, traceId,
  });
  // Mirror the request-deploy approval-creation helper used elsewhere in this file.
  const approval = createApproval(ctx, {
    gate: "ACTIVATE_NEW_LEAD_SOURCE",
    subjectType: "SourcingRun", subjectId: run.id, leadId: null,
    title: `Source ${target} ${niche.data} lead(s) in ${location}`,
    detail: `Google Places sourcing run. Candidate cap ${candidateCap}.`,
    traceId,
  });
  ctx.store.sourcingRuns.save({ ...run, approvalRequestId: approval.id });
  res.status(201).json({ run: { ...run, approvalRequestId: approval.id }, approval });
});

// GET /api/sourcing-runs
app.get("/api/sourcing-runs", requireOwner, (_req, res) => {
  res.json(ctx.store.sourcingRuns.list({ limit: 100 }));
});
```

> Implementer note: this file already has a helper that creates an `ApprovalRequest` for the deploy routes (find it near `request-deploy`). Use that exact helper instead of the `createApproval` placeholder name above — match its real signature. Do not hand-roll a second approval creator.

- [ ] **Step 4: Extend the decide-route gate switch** (`server.ts:182-186`) — add a branch:

```ts
} else if (approval.gate === "ACTIVATE_NEW_LEAD_SOURCE") {
  const run = ctx.store.sourcingRuns.findByKey?.(approval.subjectId)?.[0]
    ?? ctx.store.sourcingRuns.get(approval.subjectId);
  if (run) {
    ctx.store.sourcingRuns.save({ ...run, status: "running", updatedAt: nowIso() });
    ctx.store.queue.enqueue({ type: "lead.source", payload: { sourcingRunId: run.id }, traceId: approval.traceId });
  }
}
```

(`ctx.store.sourcingRuns.get(approval.subjectId)` is the correct lookup — `subjectId` is the run id; drop the `findByKey` half if the repo has no `findByKey`.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run apps/api/test/server.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(api): sourcing-runs create/list + decide-route enqueue"
```

---

### Task 7: RuntimeConfig defaults + env docs

**Files:**
- Modify: `packages/core/src/env.ts` (`RuntimeConfig` type + `loadConfig`)
- Modify: `.env.example`, `docs/setup.md`
- Test: `packages/core/test/env.test.ts` (append)

**Interfaces:**
- Produces: `RuntimeConfig.leadSourcing = { defaultCandidateCap: number; recheckDelayMs: number }`.

- [ ] **Step 1: Write the failing test** — append to `packages/core/test/env.test.ts`

```ts
it("exposes leadSourcing defaults", () => {
  const cfg = loadConfig();
  expect(cfg.leadSourcing.defaultCandidateCap).toBe(40);
  expect(cfg.leadSourcing.recheckDelayMs).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/env.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add to `RuntimeConfig`** in `packages/core/src/env.ts` — extend the interface and `loadConfig` (mirror the existing `emailDiscovery`/`visualScoring` blocks):

```ts
// in the RuntimeConfig type:
leadSourcing: { defaultCandidateCap: number; recheckDelayMs: number };
// in loadConfig() return:
leadSourcing: {
  defaultCandidateCap: intFromEnv(env.LEAD_SOURCING_CANDIDATE_CAP, 40),
  recheckDelayMs: intFromEnv(env.LEAD_SOURCING_RECHECK_MS, 30000),
},
```

(Use the same int-parsing helper the file already uses for `EMAIL_DISCOVERY_MAX_PAGES`; if it's inline, mirror that.)

- [ ] **Step 4: Document** — add to `.env.example` (under a sourcing comment) and `docs/setup.md`:

```
# Lead sourcing (Google Places New v1; requires GOOGLE_MAPS_API_KEY + ACTIVATE_NEW_LEAD_SOURCE approval)
LEAD_SOURCING_CANDIDATE_CAP=40   # max businesses audited per run before giving up
LEAD_SOURCING_RECHECK_MS=30000   # controller re-check interval
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run packages/core/test/env.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): leadSourcing RuntimeConfig defaults + env docs"
```

---

### Task 8: Dashboard — Source-leads form + runs list

**Files:**
- Create: `apps/dashboard/src/pages/SourcingPage.tsx`
- Modify: dashboard nav/routing (mirror how `WebsiteBriefs`/Leads pages are registered — find the route table and nav list)
- Test: manual (dashboard build); no unit test required (follow existing page patterns — they have none).

**Interfaces:**
- Consumes: `GET /api/sourcing-runs`, `POST /api/sourcing-runs`, the existing authed-fetch helper used by other pages, and `NICHE_META` (import from `@william/core`) for the niche dropdown.

- [ ] **Step 1: Build the page** — `apps/dashboard/src/pages/SourcingPage.tsx`. Mirror the structure of an existing page (e.g. `WebsiteBriefs`): a form posting `{ location, niche, target, candidateCap? }` to `/api/sourcing-runs`, and a list of runs from `GET /api/sourcing-runs` showing `status`, `candidatesIngested`, `qualifiedCount`, `target`, `resultNote`. Populate the niche `<select>` from `Object.entries(NICHE_META)` (`value` = key, label = `meta.label`). After creating a run, tell the user to grant the approval in the Review Queue.

```tsx
// Skeleton — match the project's existing fetch helper + styling.
import { useEffect, useState } from "react";
import { NICHE_META } from "@william/core";
// import { apiGet, apiPost } from "../api"; // use the project's existing helper names

export function SourcingPage() {
  const [runs, setRuns] = useState<any[]>([]);
  const [form, setForm] = useState({ location: "", niche: "coffee_shop", target: 5, candidateCap: 40 });
  const refresh = () => apiGet("/api/sourcing-runs").then(setRuns);
  useEffect(() => { refresh(); }, []);
  const submit = async () => { await apiPost("/api/sourcing-runs", form); await refresh(); };
  return (
    <section>
      <h1>Source leads</h1>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input placeholder="City, ST" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <select value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })}>
          {Object.entries(NICHE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <input type="number" min={1} value={form.target} onChange={(e) => setForm({ ...form, target: Number(e.target.value) })} />
        <input type="number" min={1} value={form.candidateCap} onChange={(e) => setForm({ ...form, candidateCap: Number(e.target.value) })} />
        <button type="submit">Create run (then grant approval in Review Queue)</button>
      </form>
      <ul>
        {runs.map((r) => (
          <li key={r.id}>{r.location} — {r.niche} — {r.status} — {r.qualifiedCount}/{r.target} qualified ({r.candidatesIngested} audited){r.resultNote ? ` — ${r.resultNote}` : ""}</li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Register the route + nav** — add `SourcingPage` to the dashboard's route table and nav list, mirroring an existing page registration.

- [ ] **Step 3: Build the dashboard**

Run: `npm run -w @william/dashboard build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(dashboard): Source-leads page (form + runs list)"
```

---

### Task 9: Full verification

- [ ] **Step 1: Typecheck** — Run: `npm run typecheck` — Expected: clean.
- [ ] **Step 2: Full suite** — Run: `npm test` — Expected: all green (existing + new sourcing/places/niche/env/store tests).
- [ ] **Step 3: Demo** — Run: `npm run demo` — Expected: end-to-end, 0 dead-letter jobs (sourcing is dormant in the demo — no `GOOGLE_MAPS_API_KEY`, local dry-run → mock Places, no run enqueued).
- [ ] **Step 4: Compliance** — sourcing touches a new gated, side-effecting path (Places + `ACTIVATE_NEW_LEAD_SOURCE`) and ingests outreach-bound leads. Run the `compliance-reviewer` subagent on the diff and apply advisories before final commit.
- [ ] **Step 5: Commit any compliance fixes**

```bash
git add -A && git commit -m "chore: compliance fixes for lead sourcing" # only if changes
```

## Self-Review (completed by plan author)

- **Spec coverage:** §1 Places adapter → Task 3; §2 SourcingRun → Task 4; §3 controller → Task 5; §4 trigger/gating/API/dashboard → Tasks 6 & 8; §5 niches → Task 1; §6 sub-35 byproduct → honored (no pipeline change; `QUALIFIED_MIN_SCORE=35` only affects the run counter); §7 error handling → Task 5 (stop states) + Task 3 (fail-closed); testing → each task + Task 9. Covered.
- **Placeholder scan:** no TBD/TODO; every code step has real code. Two explicit "use the project's existing helper" notes (approval creation in Task 6, dashboard fetch in Task 8) point at concrete existing patterns rather than inventing names — intentional, since hand-rolling a parallel approval creator or fetch helper would violate DRY.
- **Type consistency:** `SourcingRun` fields match across Tasks 4/5/6; `PlacesSearchResult { businesses, nextPageToken }` consistent in Tasks 2/3/5; `countQualified`/`leadResolved`/`IN_FLIGHT_STATUSES` defined in Task 5 and used only there; `nicheSearchQuery` defined Task 1, used Task 5; `leadSourcing` config defined Task 7, used Tasks 5/6 (note in Task 5 step 6 to inline `30000` if executed before Task 7).
