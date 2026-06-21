import type { Logger } from "@william/core";
import type { DiscoveredBusiness, PlacesAdapter, PlacesSearchResult } from "../types";
import { requireTicket, type RealDeps } from "./shared";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

// NOTE: nationalPhoneNumber deliberately omitted — we do not collect phone
// (owner decision), and it is also a pricier Places API SKU.
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

interface PlacesApiResponse {
  places?: PlacesApiPlace[];
  nextPageToken?: string;
}

/**
 * Real Places API (New) Text Search adapter.
 *
 * - Requires a PolicyTicket (invariant 2) — `requireTicket` is the first call.
 * - Returns empty under `ticket.dryRun` with zero network (invariant 3).
 * - Fail-closed: returns `{ businesses: [], nextPageToken: null }` on any HTTP
 *   error or unexpected throw — never propagates to the pipeline.
 * - Phone (`nationalPhoneNumber`) is never requested (owner decision + pricier SKU).
 */
export function createPlacesAdapter(deps: RealDeps, log: Logger): PlacesAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    name: "google-places-v1",
    async searchBusinesses(ticket, input) {
      requireTicket(ticket, "places.searchBusinesses");
      const empty: PlacesSearchResult = { businesses: [], nextPageToken: null };
      if (ticket.dryRun) return empty; // invariant 3: local never hits the network

      try {
        const body: Record<string, unknown> = {
          textQuery: input.query,
          pageSize: 20,
        };
        if (input.pageToken) body.pageToken = input.pageToken;

        const res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": deps.env.GOOGLE_MAPS_API_KEY ?? "",
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify(body),
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
          phone: null, // never collected — owner decision
          address: p.formattedAddress ?? null,
          city: null,
          rating: typeof p.rating === "number" ? p.rating : null,
        }));

        return { businesses, nextPageToken: data.nextPageToken ?? null };
      } catch (err) {
        log.warn("places searchText threw; returning empty", {
          error: err instanceof Error ? err.message : String(err),
        });
        return empty;
      }
    },
  };
}
