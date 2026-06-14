import { describe, expect, it } from "vitest";
import { CompanyFacts, WebsiteBrief } from "../src/schema/brief";

const now = new Date().toISOString();
const minimal = {
  id: "wbf_1",
  createdAt: now,
  updatedAt: now,
  leadId: "lead_1",
  buildPrompt: "Build an awwward-worthy, mobile-friendly site.",
  recommendedStack: { libs: ["Three.js", "GSAP"], plugins: [] },
  companyFacts: {},
};

describe("WebsiteBrief schema", () => {
  it("round-trips and applies the locked defaults (targetModel fable-5, generatedBy mock, status ready)", () => {
    const brief = WebsiteBrief.parse({
      ...minimal,
      opportunityId: "opp_1",
      websiteUrl: "https://example.com",
      weaknesses: ["slow load", "no mobile layout"],
      companyFacts: { services: ["haircut"], about: "A barber" },
    });
    expect(brief.targetModel).toBe("fable-5");
    expect(brief.generatedBy).toBe("mock");
    expect(brief.status).toBe("ready");
    expect(brief.repoUrl).toBeNull();
    expect(brief.opportunityId).toBe("opp_1");
  });

  it("defaults optional collections and nested contact facts", () => {
    const brief = WebsiteBrief.parse(minimal);
    expect(brief.weaknesses).toEqual([]);
    expect(brief.opportunityId).toBeNull();
    expect(brief.websiteUrl).toBeNull();
    expect(brief.companyFacts.services).toEqual([]);
    expect(brief.companyFacts.photos).toEqual([]);
    expect(brief.companyFacts.contact.email).toBeNull();
  });

  it("rejects an unknown targetModel and an unknown status", () => {
    expect(() => WebsiteBrief.parse({ ...minimal, targetModel: "gpt-9" })).toThrow();
    expect(() => WebsiteBrief.parse({ ...minimal, status: "draft" })).toThrow();
  });

  it("CompanyFacts is reusable on its own with full defaults", () => {
    const facts = CompanyFacts.parse({});
    expect(facts).toEqual({
      services: [],
      hours: null,
      photos: [],
      about: "",
      contact: { email: null, phone: null, address: null },
    });
  });
});
