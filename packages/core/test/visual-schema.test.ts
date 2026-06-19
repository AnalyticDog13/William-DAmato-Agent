import { describe, expect, it } from "vitest";
import { VisualAssessment } from "../src/schema/visual";
import { WebsiteAudit } from "../src/schema/audit";
import { Contact } from "../src/schema/lead";

const validAssessment = {
  visualOpportunityScore: 72,
  verdict: "weak",
  confidence: 0.81,
  findings: [{ category: "cta_missing_or_hidden", detail: "No CTA above the fold", severity: "high" }],
  positives: ["clean logo"],
  model: "claude-haiku-4-5-20251001",
};

describe("VisualAssessment schema", () => {
  it("parses a valid assessment", () => {
    expect(VisualAssessment.parse(validAssessment).verdict).toBe("weak");
  });
  it("rejects an out-of-range score", () => {
    expect(VisualAssessment.safeParse({ ...validAssessment, visualOpportunityScore: 140 }).success).toBe(false);
  });
  it("rejects a negative visualOpportunityScore", () => {
    expect(VisualAssessment.safeParse({ ...validAssessment, visualOpportunityScore: -1 }).success).toBe(false);
  });
  it("rejects confidence out of bounds", () => {
    expect(VisualAssessment.safeParse({ ...validAssessment, confidence: 1.5 }).success).toBe(false);
  });
  it("rejects an unknown finding category", () => {
    expect(
      VisualAssessment.safeParse({ ...validAssessment, findings: [{ category: "nope", detail: "x", severity: "low" }] }).success,
    ).toBe(false);
  });
});

describe("WebsiteAudit.visualAssessment", () => {
  it("defaults to null when omitted", () => {
    const audit = WebsiteAudit.parse({
      id: "waud_1", createdAt: "2026-06-19T00:00:00.000Z", updatedAt: "2026-06-19T00:00:00.000Z",
      leadId: "lead_1", url: null, mode: "mock", robotsAllowed: null, hasWebsite: false,
      hasSsl: null, mobileFriendly: null, lighthouse: null,
      extracted: { contactEmails: [], phones: [], socialLinks: {}, ctas: [], services: [], trustSignals: [] },
      summary: "x", auditScore: 0, completedAt: null,
    });
    expect(audit.visualAssessment).toBeNull();
  });
});

describe("Contact schema", () => {
  it("parses a valid Contact with emailSource: website_crawled", () => {
    const contact = Contact.parse({
      id: "contact_1",
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
      leadId: "lead_1",
      companyId: "company_1",
      name: "John Doe",
      role: "owner",
      email: "john@example.com",
      emailSource: "website_crawled",
      emailProvider: "gmail",
      verification: "valid",
      confidence: 0.95,
      phone: "555-1234",
    });
    expect(contact.emailSource).toBe("website_crawled");
    expect(contact.email).toBe("john@example.com");
  });
});
