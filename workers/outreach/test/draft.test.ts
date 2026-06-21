import { describe, expect, it } from "vitest";
import { nowIso, type Company, type Contact, type Lead, type WebsiteAudit } from "@william/core";
import { DELIVERY_VARIANT, FIRST_TOUCH_VARIANTS, createFirstTouchDraft, validateDraft } from "../src";

const now = nowIso();
const base = { id: "x", createdAt: now, updatedAt: now };

const lead: Lead = { ...base, id: "lead_1", companyId: "com_1", domain: "biz.example.com", websiteUrl: "https://biz.example.com", niche: "barbershop", status: "new", source: { kind: "manual", detail: "t", importedAt: now, importedBy: "owner" }, identityKeys: [], notes: "", disqualifiedReason: null } as Lead;
const company = { ...base, id: "com_1", name: "Fade Lab" } as Company;
const contact = { ...base, id: "con_1", leadId: "lead_1", name: "Sam Cuts", email: "sam@biz.example.com" } as unknown as Contact;
const audit = { ...base, id: "aud_1", leadId: "lead_1", outreachAngles: ["your site isn't mobile-friendly", "no online booking"], hasWebsite: true } as unknown as WebsiteAudit;

const input = (variant?: string) => ({ lead, company, contact, audit, variant, traceId: "trace_1" });

describe("first-touch variant registry", () => {
  it("exposes at least two variants, default first", () => {
    expect(FIRST_TOUCH_VARIANTS.length).toBeGreaterThanOrEqual(2);
    expect(FIRST_TOUCH_VARIANTS[0]).toBe("v1-cornell-mockup");
    expect(FIRST_TOUCH_VARIANTS).toContain("v2-finding-first");
  });

  it("every registered variant passes the content rules (opt-out, Cornell, mockup, length)", () => {
    for (const variant of FIRST_TOUCH_VARIANTS) {
      const draft = createFirstTouchDraft(input(variant));
      expect(validateDraft(draft), variant).toEqual([]);
      expect(draft.variant).toBe(variant);
    }
  });

  it("v2 leads with the audit finding and differs from v1 in subject and body", () => {
    const v1 = createFirstTouchDraft(input("v1-cornell-mockup"));
    const v2 = createFirstTouchDraft(input("v2-finding-first"));
    expect(v2.subject).not.toBe(v1.subject);
    expect(v2.body).not.toBe(v1.body);
    // v2 opens with the real finding before the introduction.
    expect(v2.body.indexOf("mobile-friendly")).toBeLessThan(v2.body.indexOf("Cornell"));
    expect(v2.subject.length).toBeLessThanOrEqual(70);
  });

  it("unknown variant falls back to default copy and says so in the notes", () => {
    const draft = createFirstTouchDraft(input("v9-does-not-exist"));
    expect(validateDraft(draft)).toEqual([]);
    expect(draft.variant).toBe("v1-cornell-mockup");
    expect(draft.personalizationNotes.join()).toMatch(/unknown variant/i);
  });

  it("default (no variant) is unchanged v1", () => {
    const draft = createFirstTouchDraft(input());
    expect(draft.variant).toBe("v1-cornell-mockup");
    expect(draft.body).toMatch(/already built a free mockup/i);
  });

  it("first-touch copy contains NO link/URL (no mockup link, no personal site)", () => {
    for (const variant of FIRST_TOUCH_VARIANTS) {
      const draft = createFirstTouchDraft(input(variant));
      expect(draft.body, variant).not.toMatch(/https?:\/\/|www\.|williamdamato\.com|\bbiz\.example\.com\b/i);
      expect(validateDraft(draft), variant).toEqual([]);
    }
  });

  it("validateDraft blocks a link in pre-reply copy but allows it in the delivery email", () => {
    const base = createFirstTouchDraft(input());
    const withUrl = { ...base, body: `${base.body}\n\nSee it live at williamdamato.com` };
    expect(validateDraft(withUrl).some((p) => /link\/URL/i.test(p))).toBe(true);
    // The delivery email is the one place a URL belongs — exempt by its variant.
    const delivery = { ...withUrl, variant: DELIVERY_VARIANT };
    expect(validateDraft(delivery).some((p) => /link\/URL/i.test(p))).toBe(false);
  });
});
