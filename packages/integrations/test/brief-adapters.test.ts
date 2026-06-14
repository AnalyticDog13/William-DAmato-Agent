import { describe, expect, it } from "vitest";
import { CompanyFacts, createLogger, type PolicyTicket } from "@william/core";
import { createLlmAdapter, createMockFirecrawl, createMockLlm } from "../src";

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

describe("firecrawl mock adapter", () => {
  it("requires a PolicyTicket (operational reads are still ticketed)", async () => {
    const fc = createMockFirecrawl(log);
    await expect(fc.scrapeCompany(undefined as unknown as PolicyTicket, "https://x.com")).rejects.toThrow(/SECURITY/);
  });

  it("synthesizes CompanyFacts from audit-derived hints", async () => {
    const fc = createMockFirecrawl(log);
    const facts = await fc.scrapeCompany(ticket(true), "https://barber.example.com", {
      companyName: "Fade Factory",
      niche: "barbershop",
      services: ["fades", "beard trim"],
      contactEmails: ["info@barber.example.com"],
      phones: ["+1-607-555-0100"],
      about: "Old-school barbershop in Ithaca",
    });
    expect(facts.services).toContain("fades");
    expect(facts.contact.email).toBe("info@barber.example.com");
    expect(facts.contact.phone).toBe("+1-607-555-0100");
    expect(facts.about).toContain("Old-school");
  });

  it("returns valid (empty-default) CompanyFacts when there are no hints", async () => {
    const fc = createMockFirecrawl(log);
    const facts = await fc.scrapeCompany(ticket(true), "https://nothing.example.com");
    expect(CompanyFacts.parse(facts)).toEqual(facts); // schema-valid
    expect(facts.services).toEqual([]);
  });
});

describe("llm mock adapter (build-prompt generation)", () => {
  const req = {
    companyName: "Fade Factory",
    niche: "barbershop",
    websiteUrl: "https://barber.example.com",
    weaknesses: ["No mobile layout", "Slow hero image"],
    companyFacts: CompanyFacts.parse({
      services: ["fades", "hot-towel shave"],
      about: "Old-school barbershop in Ithaca",
      contact: { phone: "+1-607-555-0100" },
    }),
  };

  it("requires a PolicyTicket", async () => {
    const llm = createMockLlm(log);
    await expect(llm.generateBuildPrompt(undefined as unknown as PolicyTicket, req)).rejects.toThrow(/SECURITY/);
  });

  it("templates a mobile-friendly, awwward-worthy prompt quoting weaknesses + real facts", async () => {
    const llm = createMockLlm(log);
    const res = await llm.generateBuildPrompt(ticket(true), req);
    expect(res.generatedBy).toBe("mock");
    // owner-required notes: mobile-friendly/interactive + awwward-worthy
    expect(res.buildPrompt).toMatch(/mobile/i);
    expect(res.buildPrompt).toMatch(/interactive/i);
    expect(res.buildPrompt).toMatch(/awwward/i);
    // quotes the real business + audit findings as material to transform
    expect(res.buildPrompt).toContain("Fade Factory");
    expect(res.buildPrompt).toContain("No mobile layout");
    expect(res.buildPrompt).toContain("fades");
    // recommended stack present
    expect(res.recommendedStack.libs.join(" ")).toMatch(/Framer Motion|GSAP|Three\.js/i);
  });
});

describe("llm adapter (outreach copy)", () => {
  const outreachReq = {
    kind: "first_touch" as const,
    variant: "v1-cornell-mockup",
    companyName: "Fade Factory",
    niche: "barbershop",
    firstName: "Sam",
    websiteUrl: "https://barber.example.com",
    hasWebsite: true,
    auditFindings: ["slow mobile load", "no online booking"],
  };

  it("mock returns null (no LLM copy → caller keeps the template) and requires a ticket", async () => {
    const llm = createMockLlm(log);
    await expect(llm.generateOutreachCopy(undefined as unknown as PolicyTicket, outreachReq)).rejects.toThrow(/SECURITY/);
    expect(await llm.generateOutreachCopy(ticket(true), outreachReq)).toBeNull();
  });

  it("real adapter returns null under dry-run (local always stays on templates, zero network)", async () => {
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-ant-test" } }, log);
    expect(await llm.generateOutreachCopy(ticket(true), outreachReq)).toBeNull();
  });
});
