import { describe, expect, it } from "vitest";
import { nowIso, type Contact, type Lead, type LeadScore, type ReplyEvent, type WebsiteAudit } from "@william/core";
import { MAX_TOUCHES, createFollowUpDraft, evaluateFollowUp, nextFollowUp, validateDraft } from "../src";

const now = nowIso();
const base = { id: "x", createdAt: now, updatedAt: now };

const lead = (status: Lead["status"] = "contacted"): Lead =>
  ({ ...base, id: "lead_1", companyId: "com_1", domain: "biz.example.com", websiteUrl: "https://biz.example.com", niche: "barbershop", status, source: { kind: "manual", detail: "t", importedAt: now, importedBy: "owner" }, identityKeys: [], notes: "", disqualifiedReason: null }) as Lead;

const score = (tier: LeadScore["tier"]): LeadScore =>
  ({ ...base, id: "ls_1", leadId: "lead_1", auditId: null, score: 70, tier, reasons: [], scoredAt: now }) as LeadScore;

const audit = (angles: string[] = ["your site isn't mobile-friendly"]): WebsiteAudit =>
  ({ ...base, id: "aud_1", leadId: "lead_1", outreachAngles: angles, hasWebsite: true }) as unknown as WebsiteAudit;

const contact = (verification = "unverified"): Contact =>
  ({ ...base, id: "con_1", leadId: "lead_1", name: "Sam Cuts", email: "sam@biz.example.com", verification }) as unknown as Contact;

const reply = (intent: ReplyEvent["intent"]): ReplyEvent =>
  ({ ...base, id: "rply_1", leadId: "lead_1", contactId: null, provider: "manual", externalMessageId: null, receivedAt: now, intent, intentConfidence: 0.9, bodyExcerpt: "", threadSummary: "", recommendedNextStep: "", ownerNotifiedAt: null, followUpsPaused: false }) as ReplyEvent;

const happy = () => ({ lead: lead(), score: score("warm"), audit: audit(), contact: contact(), replies: [] as ReplyEvent[], sequence: 1 as const, priorTouchCount: 1 });

describe("evaluateFollowUp (owner's keep/skip rules)", () => {
  it("qualified silent lead is eligible", () => {
    expect(evaluateFollowUp(happy())).toEqual({ eligible: true, skipReasons: [] });
  });

  it("weak/bad leads never get follow-ups", () => {
    expect(evaluateFollowUp({ ...happy(), score: score("cold") }).eligible).toBe(false);
    expect(evaluateFollowUp({ ...happy(), score: score("skip") }).eligible).toBe(false);
    expect(evaluateFollowUp({ ...happy(), score: null }).eligible).toBe(false);
  });

  it("medium-strength (warm) leads get one follow-up only; hot leads get two", () => {
    expect(evaluateFollowUp({ ...happy(), score: score("warm"), sequence: 2 }).eligible).toBe(false);
    expect(evaluateFollowUp({ ...happy(), score: score("hot"), sequence: 2 }).eligible).toBe(true);
    expect(evaluateFollowUp({ ...happy(), score: score("warm"), sequence: 1 }).eligible).toBe(true);
  });

  it("any decisive reply ends the sequence — said no, unsubscribed, bounced, or even interested", () => {
    for (const intent of ["negative", "unsubscribe", "bounce", "positive", "neutral"] as const) {
      const verdict = evaluateFollowUp({ ...happy(), replies: [reply(intent)] });
      expect(verdict.eligible).toBe(false);
      expect(verdict.skipReasons.join()).toContain("replied");
    }
  });

  it("auto-replies (out of office) do not count as a response", () => {
    expect(evaluateFollowUp({ ...happy(), replies: [reply("auto_reply")] }).eligible).toBe(true);
  });

  it("skips without a real improvement angle, contact path, or on bounce-invalid email", () => {
    expect(evaluateFollowUp({ ...happy(), audit: audit([]) }).eligible).toBe(false);
    expect(evaluateFollowUp({ ...happy(), audit: null }).eligible).toBe(false);
    expect(evaluateFollowUp({ ...happy(), contact: null }).eligible).toBe(false);
    expect(evaluateFollowUp({ ...happy(), contact: contact("invalid") }).eligible).toBe(false);
  });

  it("caps total touches and only chases silence after a send", () => {
    expect(evaluateFollowUp({ ...happy(), priorTouchCount: MAX_TOUCHES }).eligible).toBe(false);
    expect(evaluateFollowUp({ ...happy(), lead: lead("replied") }).eligible).toBe(false);
    expect(evaluateFollowUp({ ...happy(), lead: lead("do_not_contact") }).eligible).toBe(false);
  });
});

describe("createFollowUpDraft (polite, short, easy to say yes)", () => {
  const input = { lead: lead(), company: { ...base, id: "com_1", name: "Fade Lab" } as never, contact: contact(), audit: audit(), traceId: "trace_1" };

  it("both sequences pass the same content rules as first touch", () => {
    for (const sequence of [1, 2] as const) {
      const draft = createFollowUpDraft({ ...input, sequence });
      expect(validateDraft(draft)).toEqual([]);
      expect(draft.variant).toBe(`followup-${sequence}`);
    }
  });

  it("#1 bumps politely and reuses the real audit finding + mockup offer", () => {
    const draft = createFollowUpDraft({ ...input, sequence: 1 });
    expect(draft.body).toMatch(/bump this/i);
    expect(draft.body).toContain("your site isn't mobile-friendly");
    expect(draft.body).toMatch(/free mockup/i);
    expect(draft.body).not.toMatch(/sorry|apolog|desperate|please respond/i);
  });

  it("#2 is a short, final, zero-pressure close", () => {
    const draft = createFollowUpDraft({ ...input, sequence: 2 });
    expect(draft.body).toMatch(/last note/i);
    expect(draft.body.length).toBeLessThan(600);
    expect(draft.body).toMatch(/even if the answer is/i);
  });

  it("subject falls back when a long company name would overflow", () => {
    const long = { ...base, id: "com_1", name: "The Extraordinarily Long Business Name Emporium And Sons LLC" } as never;
    const draft = createFollowUpDraft({ ...input, company: long, sequence: 1 });
    expect(draft.subject.length).toBeLessThanOrEqual(70);
  });
});

describe("nextFollowUp scheduling chain", () => {
  it("first touch → #1 (~3.5d), #1 → #2 (~9d), #2 → done", () => {
    expect(nextFollowUp("v1-cornell-mockup")).toMatchObject({ sequence: 1, delayDays: 3.5 });
    expect(nextFollowUp("followup-1")).toMatchObject({ sequence: 2, delayDays: 9 });
    expect(nextFollowUp("followup-2")).toBeNull();
  });
});
