import { describe, expect, it } from "vitest";
import { scoreLead, nowIso, type WebsiteAudit } from "../src/index";

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

  it("robots.txt disallow zeroes the lead out", () => {
    const r = scoreLead(audit({ robotsAllowed: false, hasSsl: false, mobileFriendly: false }));
    expect(r.tier).toBe("skip");
    expect(r.score).toBeLessThan(20);
  });

  it("every score movement is explained", () => {
    const r = scoreLead(audit({ hasSsl: false }));
    expect(r.reasons.length).toBeGreaterThan(0);
    for (const reason of r.reasons) expect(reason).toMatch(/^[+-]?\d+: /);
  });
});
