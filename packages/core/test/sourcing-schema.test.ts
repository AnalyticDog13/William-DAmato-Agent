import { describe, expect, it } from "vitest";
import { SourcingRun } from "../src";

function minimalRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "abcd1234",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    location: "Austin, TX",
    niche: "restaurant",
    target: 10,
    candidateCap: 40,
    status: "running",
    traceId: "trace-001",
    ...overrides,
  };
}

describe("SourcingRun schema — batch-sweep fields", () => {
  it("SourcingRun accepts mode + nicheQueue + currentNiche", () => {
    const run = SourcingRun.parse({
      ...minimalRun(),
      mode: "batch",
      nicheQueue: ["restaurant", "plumbing"],
      currentNiche: "restaurant",
    });
    expect(run.mode).toBe("batch");
    expect(run.nicheQueue).toEqual(["restaurant", "plumbing"]);
    expect(run.currentNiche).toBe("restaurant");
  });

  it("mode defaults to normal when omitted", () => {
    const run = SourcingRun.parse(minimalRun());
    expect(run.mode).toBe("normal");
  });

  it("nicheQueue defaults to [] when omitted", () => {
    const run = SourcingRun.parse(minimalRun());
    expect(run.nicheQueue).toEqual([]);
  });

  it("currentNiche defaults to null when omitted", () => {
    const run = SourcingRun.parse(minimalRun());
    expect(run.currentNiche).toBeNull();
  });
});
