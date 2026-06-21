import { describe, expect, it } from "vitest";
import { createLogger, type PolicyTicket } from "@william/core";
import { createMockPlaces } from "../src/mocks";

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
});
