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
