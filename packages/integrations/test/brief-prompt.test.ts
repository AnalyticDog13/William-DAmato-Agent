import { describe, expect, it } from "vitest";
import { templateBuildPrompt } from "../src/brief-prompt";

const req = {
  companyName: "Joe's", niche: "barbershop", websiteUrl: "https://x.com",
  weaknesses: ["no CTA"],
  companyFacts: { services: ["cuts"], hours: null, photos: [], about: "barbers", contact: { email: "o@x.com", phone: null, address: null } },
} as any;

describe("templateBuildPrompt (condensed)", () => {
  const out = templateBuildPrompt(req).buildPrompt;
  it("ends with the literal superpowers line", () => {
    expect(out.trimEnd().endsWith("do not use superpowers")).toBe(true);
  });
  it("is at most 3 paragraphs", () => {
    const paras = out.trim().split(/\n\s*\n/).filter(Boolean);
    expect(paras.length).toBeLessThanOrEqual(3);
  });
  it("retains every owner-required element", () => {
    for (const kw of ["Higgsfield", "GSAP", "Three.js", "backend", "loading", "SEO", "Chrome DevTools", "Framer", "Figma", "React", "frontend-design"]) {
      expect(out).toContain(kw);
    }
  });
});
