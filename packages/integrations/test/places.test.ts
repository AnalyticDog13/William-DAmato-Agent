import { describe, expect, it } from "vitest";
import { createLogger, type PolicyTicket } from "@william/core";
import { createMockPlaces } from "../src/mocks";
import { createPlacesAdapter } from "../src/real/places";

const log = createLogger({ app: "test" }, () => {});

function ticket(dryRun: boolean): PolicyTicket {
  return {
    __policyTicket: true,
    gate: null,
    subjectType: "Test",
    subjectId: "subj_1",
    traceId: "trace_1",
    dryRun,
    issuedAt: new Date().toISOString(),
    nonce: "nonce_1",
  } as unknown as PolicyTicket;
}

describe("mock places adapter (new shape)", () => {
  it("returns { businesses, nextPageToken }", async () => {
    const places = createMockPlaces();
    const res = await places.searchBusinesses(ticket(false), { query: "coffee shops in Ithaca, NY", location: "Ithaca, NY" });
    expect(Array.isArray(res.businesses)).toBe(true);
    expect(res).toHaveProperty("nextPageToken");
  });

  it("sets phone: null on all returned businesses", async () => {
    const places = createMockPlaces();
    const res = await places.searchBusinesses(ticket(false), { query: "coffee shops in Ithaca, NY", location: "Ithaca, NY" });
    expect(res.businesses.length).toBeGreaterThan(0);
    expect(res.businesses.every((b) => b.phone === null)).toBe(true);
    expect(res.nextPageToken).toBeNull();
  });

  it("returns empty businesses on pageToken (no infinite pages)", async () => {
    const places = createMockPlaces();
    const res = await places.searchBusinesses(ticket(false), { query: "coffee shops in Ithaca, NY", location: "Ithaca, NY", pageToken: "token_abc" });
    expect(res.businesses).toHaveLength(0);
    expect(res.nextPageToken).toBeNull();
  });
});

// --- Real adapter tests (Task 3) ---
const dryTicket = { id: "t", dryRun: true, __policyTicket: true } as unknown as PolicyTicket;
const liveTicket = { id: "t", dryRun: false, __policyTicket: true } as unknown as PolicyTicket;

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
