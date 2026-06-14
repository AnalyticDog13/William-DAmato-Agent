import { describe, expect, it } from "vitest";
import { CompanyFacts, createLogger, type PolicyTicket } from "@william/core";
import { createFirecrawlAdapter, createLlmAdapter, createMockFirecrawl, createMockLlm } from "../src";

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

describe("firecrawl real adapter (scrape → CompanyFacts merge)", () => {
  /** Fake fetch returning a Firecrawl /v1/scrape body, recording call count. */
  function fakeFirecrawl(body: unknown, status = 200) {
    const calls: string[] = [];
    const impl = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  const scrapeBody = (metadata: Record<string, unknown>, markdown = "") => ({
    success: true,
    data: { markdown, links: [], metadata: { sourceURL: "https://x.example.com", statusCode: 200, ...metadata } },
  });

  it("simulates from hints on dry-run without touching the network", async () => {
    const { impl, calls } = fakeFirecrawl(scrapeBody({ description: "ignored" }));
    const fc = createFirecrawlAdapter({ env: { FIRECRAWL_API_KEY: "fc-test" }, fetchImpl: impl }, log);
    const facts = await fc.scrapeCompany(ticket(true), "https://x.example.com", { companyName: "Fade Factory", niche: "barbershop" });
    expect(calls.length).toBe(0);
    expect(facts.about).toContain("Fade Factory");
  });

  it("maps metadata.description to about and fills missing contact from the page markdown", async () => {
    const md = "Welcome to Fade Factory.\n\nCall us at (607) 555-0150 or email hello@fadefactory.example.com.";
    const { impl } = fakeFirecrawl(scrapeBody({ title: "Fade Factory", description: "Ithaca's premier barbershop since 2009." }, md));
    const fc = createFirecrawlAdapter({ env: { FIRECRAWL_API_KEY: "fc-test" }, fetchImpl: impl }, log);
    const facts = await fc.scrapeCompany(ticket(false), "https://x.example.com"); // no hints → audit floor is empty
    expect(facts.about).toBe("Ithaca's premier barbershop since 2009.");
    expect(facts.contact.email).toBe("hello@fadefactory.example.com");
    expect(facts.contact.phone).toContain("555-0150");
    expect(CompanyFacts.parse(facts)).toEqual(facts); // still schema-valid
  });

  it("normalizes a metadata.description ARRAY to a single about string", async () => {
    const { impl } = fakeFirecrawl(scrapeBody({ description: ["First sentence.", "Second sentence."] }));
    const fc = createFirecrawlAdapter({ env: { FIRECRAWL_API_KEY: "fc-test" }, fetchImpl: impl }, log);
    const facts = await fc.scrapeCompany(ticket(false), "https://x.example.com");
    expect(facts.about).toBe("First sentence.");
  });

  it("never overrides an audit-confirmed contact with a scraped one", async () => {
    const md = "Reach us at hello@scraped.example.com.";
    const { impl } = fakeFirecrawl(scrapeBody({ description: "desc" }, md));
    const fc = createFirecrawlAdapter({ env: { FIRECRAWL_API_KEY: "fc-test" }, fetchImpl: impl }, log);
    const facts = await fc.scrapeCompany(ticket(false), "https://x.example.com", { contactEmails: ["audit@confirmed.example.com"] });
    expect(facts.contact.email).toBe("audit@confirmed.example.com");
  });

  it("falls back to audit-derived synthesis on an HTTP error", async () => {
    const { impl } = fakeFirecrawl("rate limited", 429);
    const fc = createFirecrawlAdapter({ env: { FIRECRAWL_API_KEY: "fc-test" }, fetchImpl: impl }, log);
    const facts = await fc.scrapeCompany(ticket(false), "https://x.example.com", { companyName: "Fallback Co", niche: "cafe" });
    expect(facts.about).toContain("Fallback Co");
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

describe("llm adapter (reply classification)", () => {
  /** Fake fetch returning one Anthropic-shaped text block, recording call count. */
  function fakeAnthropic(text: string, status = 200) {
    const calls: string[] = [];
    const impl = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("mock returns null (caller keeps the regex result) and requires a ticket", async () => {
    const llm = createMockLlm(log);
    await expect(llm.classifyReply(undefined as unknown as PolicyTicket, { text: "hi" })).rejects.toThrow(/SECURITY/);
    expect(await llm.classifyReply(ticket(true), { text: "hi" })).toBeNull();
  });

  it("real adapter returns null under dry-run without touching the network", async () => {
    const { impl, calls } = fakeAnthropic("positive");
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetchImpl: impl }, log);
    expect(await llm.classifyReply(ticket(true), { text: "maybe later" })).toBeNull();
    expect(calls.length).toBe(0);
  });

  it("real adapter parses a valid ReplyIntent label from the model response", async () => {
    const { impl } = fakeAnthropic("positive");
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetchImpl: impl }, log);
    const res = await llm.classifyReply(ticket(false), { text: "circle back next week" });
    expect(res?.intent).toBe("positive");
    expect(res?.confidence).toBeGreaterThan(0);
    expect(res?.confidence).toBeLessThanOrEqual(1);
  });

  it("real adapter returns null on a non-enum label (caller falls back to regex)", async () => {
    const { impl } = fakeAnthropic("maybe");
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetchImpl: impl }, log);
    expect(await llm.classifyReply(ticket(false), { text: "hmm" })).toBeNull();
  });

  it("real adapter returns null on an HTTP error", async () => {
    const { impl } = fakeAnthropic("positive", 500);
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetchImpl: impl }, log);
    expect(await llm.classifyReply(ticket(false), { text: "hmm" })).toBeNull();
  });

  it("real adapter returns null when the model is itself unsure (answers 'unknown')", async () => {
    const { impl } = fakeAnthropic("unknown");
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetchImpl: impl }, log);
    expect(await llm.classifyReply(ticket(false), { text: "hmm" })).toBeNull();
  });

  it("real adapter tolerates a trailing period on the label", async () => {
    const { impl } = fakeAnthropic("negative.");
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetchImpl: impl }, log);
    expect((await llm.classifyReply(ticket(false), { text: "no thanks, we built our own" }))?.intent).toBe("negative");
  });
});

describe("llm adapter (transcript insight extraction)", () => {
  function fakeAnthropic(text: string, status = 200) {
    const calls: string[] = [];
    const impl = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  const req = { source: "design-call.txt", text: "We talked about bold hero sections and anchoring price at $750." };

  it("mock returns null (caller keeps the deterministic extractor) and requires a ticket", async () => {
    const llm = createMockLlm(log);
    await expect(llm.extractTranscriptInsights(undefined as unknown as PolicyTicket, req)).rejects.toThrow(/SECURITY/);
    expect(await llm.extractTranscriptInsights(ticket(true), req)).toBeNull();
  });

  it("real adapter returns null under dry-run without touching the network", async () => {
    const { impl, calls } = fakeAnthropic("[]");
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetchImpl: impl }, log);
    expect(await llm.extractTranscriptInsights(ticket(true), req)).toBeNull();
    expect(calls.length).toBe(0);
  });

  it("real adapter parses a JSON array of {topic, insight} from the model response", async () => {
    const { impl } = fakeAnthropic(
      JSON.stringify([
        { topic: "design", insight: "Use a bold, full-bleed hero section" },
        { topic: "pricing", insight: "Anchor builds at $750" },
      ]),
    );
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetchImpl: impl }, log);
    const res = await llm.extractTranscriptInsights(ticket(false), req);
    expect(res).toHaveLength(2);
    expect(res?.[0]).toEqual({ topic: "design", insight: "Use a bold, full-bleed hero section" });
  });

  it("real adapter drops malformed entries and keeps the valid ones", async () => {
    const { impl } = fakeAnthropic(
      JSON.stringify([{ topic: "design", insight: "Keep it mobile-first" }, { topic: "design" }, { insight: "" }, "nope"]),
    );
    const llm = createLlmAdapter({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetchImpl: impl }, log);
    const res = await llm.extractTranscriptInsights(ticket(false), req);
    expect(res).toEqual([{ topic: "design", insight: "Keep it mobile-first" }]);
  });

  it("real adapter returns null on a non-array body, empty array, or HTTP error", async () => {
    const bad = fakeAnthropic('{"not":"an array"}');
    const empty = fakeAnthropic("[]");
    const err = fakeAnthropic("[]", 500);
    const env = { ANTHROPIC_API_KEY: "sk-ant-test" };
    expect(await createLlmAdapter({ env, fetchImpl: bad.impl }, log).extractTranscriptInsights(ticket(false), req)).toBeNull();
    expect(await createLlmAdapter({ env, fetchImpl: empty.impl }, log).extractTranscriptInsights(ticket(false), req)).toBeNull();
    expect(await createLlmAdapter({ env, fetchImpl: err.impl }, log).extractTranscriptInsights(ticket(false), req)).toBeNull();
  });
});
