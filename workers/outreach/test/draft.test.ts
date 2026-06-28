import { describe, expect, it } from "vitest";
import { nowIso, type Company, type Contact, type Lead, type WebsiteAudit } from "@william/core";
import { createFirstTouchDraft, validateDraft, OPT_OUT_LINE, FIRST_TOUCH_VARIANT } from "../src/draft";

const now = nowIso();
const base = { id: "x", createdAt: now, updatedAt: now };

const lead: Lead = {
  ...base,
  id: "lead_1",
  companyId: "com_1",
  domain: "biz.example.com",
  websiteUrl: "https://biz.example.com",
  niche: "barbershop",
  status: "new",
  source: { kind: "manual", detail: "t", importedAt: now, importedBy: "owner" },
  identityKeys: [],
  notes: "",
  disqualifiedReason: null,
} as Lead;
const company = {
  ...base,
  id: "com_1",
  name: "Fade Lab",
  city: "Austin",
} as Company;
const contact = {
  ...base,
  id: "con_1",
  leadId: "lead_1",
  name: "Sam Cuts",
  email: "sam@biz.example.com",
} as unknown as Contact;
const audit = {
  ...base,
  id: "aud_1",
  leadId: "lead_1",
  outreachAngles: ["your site isn't mobile-friendly", "no online booking"],
  hasWebsite: true,
} as unknown as WebsiteAudit;

function fixture() {
  return { lead, company, contact, audit, traceId: "trace_1" };
}

describe("first-touch email content rules", () => {
  it("first-touch email is <=5 sentences, has no emdash, Cornell, mockup, and the P.S. opt-out", () => {
    const draft = createFirstTouchDraft(fixture());
    expect(validateDraft(draft)).toEqual([]);
    expect(draft.body).toContain(OPT_OUT_LINE);
    expect(/cornell/i.test(draft.body)).toBe(true);
    expect(/mockup/i.test(draft.body)).toBe(true);
    expect(/[—–]|--/.test(draft.body)).toBe(false);
  });

  it("OPT_OUT_LINE is a friendly P.S. with a comma, not an emdash", () => {
    expect(OPT_OUT_LINE.startsWith("P.S.")).toBe(true);
    expect(/[—–]/.test(OPT_OUT_LINE)).toBe(false);
  });

  it("validateDraft rejects a body over 5 sentences", () => {
    const draft = createFirstTouchDraft(fixture());
    const bloated = {
      ...draft,
      body: draft.body.replace(
        OPT_OUT_LINE,
        "One. Two. Three. Four. Five. Six.\n\n" + OPT_OUT_LINE,
      ),
    };
    expect(validateDraft(bloated)).toContain("body too long (>5 sentences)");
  });

  it("validateDraft rejects an emdash", () => {
    const draft = createFirstTouchDraft(fixture());
    const bad = { ...draft, body: draft.body + "\nextra — dash" };
    expect(validateDraft(bad)).toContain("contains an emdash");
  });
});

describe("first-touch variant", () => {
  it("FIRST_TOUCH_VARIANT is the single variant id", () => {
    expect(FIRST_TOUCH_VARIANT).toBe("v1-cornell-mockup");
  });

  it("draft uses FIRST_TOUCH_VARIANT", () => {
    const draft = createFirstTouchDraft(fixture());
    expect(draft.variant).toBe(FIRST_TOUCH_VARIANT);
  });

  it("first-touch copy contains NO link/URL", () => {
    const draft = createFirstTouchDraft(fixture());
    expect(draft.body).not.toMatch(/https?:\/\/|www\.|williamdamato\.com|\bbiz\.example\.com\b/i);
    expect(validateDraft(draft)).toEqual([]);
  });

  it("validateDraft blocks a link/URL unconditionally", () => {
    const base = createFirstTouchDraft(fixture());
    const withUrl = { ...base, body: `${base.body}\n\nSee it live at williamdamato.com` };
    expect(validateDraft(withUrl).some((p) => /link\/URL/i.test(p))).toBe(true);
  });
});
