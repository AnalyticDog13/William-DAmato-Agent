import { describe, expect, it } from "vitest";
import { scoreLead, nowIso, type WebsiteAudit, type VisualAssessment } from "../src/index";

function audit(overrides: Partial<WebsiteAudit> = {}): WebsiteAudit {
  const now = nowIso();
  return {
    id: "aud_1",
    createdAt: now,
    updatedAt: now,
    leadId: "lead_1",
    url: "https://example.com",
    mode: "mock",
    robotsAllowed: true,
    hasWebsite: true,
    hasSsl: true,
    mobileFriendly: true,
    pages: [],
    lighthouse: { performance: 90, accessibility: 90, bestPractices: 90, seo: 90 },
    a11yFindings: [],
    extracted: {
      contactEmails: ["hello@example.com"],
      phones: [],
      socialLinks: {},
      ctas: ["Book now"],
      services: [],
      trustSignals: ["reviews"],
    },
    weaknesses: [],
    outreachAngles: [],
    summary: "fine site",
    auditScore: 85,
    completedAt: now,
    visualAssessment: null,
    ...overrides,
  };
}

describe("scoreLead", () => {
  it("a business with no website is a hot lead", () => {
    const r = scoreLead(audit({ hasWebsite: false }));
    expect(r.tier).toBe("hot");
    expect(r.reasons.join(" ")).toMatch(/No website/);
  });

  it("a healthy modern site is skip/cold tier", () => {
    const r = scoreLead(audit());
    expect(["skip", "cold"]).toContain(r.tier);
  });

  it("slow, insecure, non-mobile sites score high", () => {
    const r = scoreLead(
      audit({
        hasSsl: false,
        mobileFriendly: false,
        lighthouse: { performance: 25, accessibility: 50, bestPractices: 60, seo: 40 },
        extracted: {
          contactEmails: ["owner@biz.com"],
          phones: [],
          socialLinks: {},
          ctas: [],
          services: [],
          trustSignals: [],
        },
      }),
    );
    expect(r.tier).toBe("hot");
    expect(r.score).toBeGreaterThanOrEqual(65);
  });

  it("every score movement is explained", () => {
    const r = scoreLead(audit({ hasSsl: false }));
    expect(r.reasons.length).toBeGreaterThan(0);
    for (const reason of r.reasons) expect(reason).toMatch(/^[+-]?\d+: /);
  });

  it("phone-only is NOT reachable (email-only outreach)", () => {
    const phoneOnly = scoreLead(audit({ extracted: { contactEmails: [], phones: ["+1-607-555-0100"], socialLinks: {}, ctas: [], services: [], trustSignals: [] } }));
    const noContact = scoreLead(audit({ extracted: { contactEmails: [], phones: [], socialLinks: {}, ctas: [], services: [], trustSignals: [] } }));
    expect(phoneOnly.score).toBe(noContact.score); // phone earns no reachability credit
  });

  it("a crawl-resolved email earns reachability even when the HTML has none (no -10)", () => {
    const noHtmlEmail = audit({ extracted: { contactEmails: [], phones: [], socialLinks: {}, ctas: ["book"], services: [], trustSignals: ["reviews"] } });
    const htmlOnly = scoreLead(noHtmlEmail); // HTML has no email → -10 penalty
    const resolvedByCrawl = scoreLead(noHtmlEmail, null, undefined, { reachableEmail: true });
    expect(htmlOnly.reasons.join(" ")).toMatch(/No email found/);
    expect(resolvedByCrawl.reasons.join(" ")).toMatch(/reachable for email outreach/);
    expect(resolvedByCrawl.reasons.join(" ")).not.toMatch(/No email found/);
    expect(resolvedByCrawl.score).toBeGreaterThan(htmlOnly.score);
  });

  it("explicit reachableEmail:false still penalizes (-10) regardless of HTML emails", () => {
    const withHtmlEmail = audit(); // has hello@example.com in HTML
    const r = scoreLead(withHtmlEmail, null, undefined, { reachableEmail: false });
    expect(r.reasons.join(" ")).toMatch(/No email found/);
  });

  it("null visual assessment leaves the score unchanged", () => {
    const a = audit({});
    expect(scoreLead(a, null).score).toBe(scoreLead(a).score);
  });

  it("a confident WEAK verdict promotes a technically-clean site into contact range", () => {
    const clean = audit({
      hasSsl: true, mobileFriendly: true,
      lighthouse: { performance: 95, accessibility: 95, bestPractices: 95, seo: 95 },
      extracted: { contactEmails: ["owner@x.com"], phones: [], socialLinks: {}, ctas: ["book now"], services: [], trustSignals: ["reviews"] },
      weaknesses: [],
    });
    const visual: VisualAssessment = { visualOpportunityScore: 20, verdict: "weak", confidence: 0.9, findings: [], positives: [], model: "m" };
    const promoted = scoreLead(clean, visual);
    expect(promoted.score).toBe(40);
    expect(promoted.tier).toBe("warm");
  });

  it("a confident STRONG verdict demotes a technically-weak site to skip", () => {
    const weakTech = audit({
      hasSsl: false, mobileFriendly: false,
      lighthouse: { performance: 20, accessibility: 30, bestPractices: 40, seo: 25 },
      extracted: { contactEmails: ["owner@x.com"], phones: [], socialLinks: {}, ctas: [], services: [], trustSignals: [] },
      weaknesses: [{ category: "conversion", detail: "no CTA", severity: "high" }],
    });
    const visual: VisualAssessment = { visualOpportunityScore: 5, verdict: "strong", confidence: 0.9, findings: [], positives: ["clear, polished, effective"], model: "m" };
    expect(scoreLead(weakTech, visual).tier).toBe("skip");
  });
});
