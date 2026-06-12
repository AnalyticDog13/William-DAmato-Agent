import {
  newId,
  nowIso,
  type Company,
  type Contact,
  type Lead,
  type LeadScore,
  type OutreachDraft,
  type ReplyEvent,
  type WebsiteAudit,
} from "@william/core";
import { OPT_OUT_LINE } from "./draft";

/**
 * Follow-up policy (owner spec): hot leads get at most TWO follow-ups — the
 * first ~3-4 days after no response, the second ~8-10 days after that.
 * Medium-strength (warm) leads get ONE; weak/bad (cold/skip) get none.
 * Polite, short, zero pressure: "just bumping this" + the same real website
 * finding + the same free-mockup offer. Never annoyed, desperate, or fake.
 * Any no / unsubscribe / bounce stops the sequence forever, and 14+ days of
 * silence after the final touch closes the lead as not interested.
 *
 * Priority rule (owner spec): warm replies > approved previews > strong new
 * leads > follow-ups > weak leads. Structurally enforced: follow-ups are one
 * delayed job per lead (never a bulk scan, so they can't become the main
 * job); any reply moves the lead off "contacted" status which cancels the
 * follow-up at evaluation time; and every follow-up still goes through the
 * owner's review queue, where warm-reply notifications already lead.
 */
export const FOLLOW_UP_SCHEDULE = [
  { sequence: 1, delayDays: 3.5 }, // 3-4 days after first touch, no response
  { sequence: 2, delayDays: 9 }, // 8-10 days after follow-up 1, no response
] as const;

/** First touch + two follow-ups. Never contact a lead more times than this. */
export const MAX_TOUCHES = 3;

/** Silence this long after the last touch closes the lead as not interested. */
export const NO_RESPONSE_CLOSE_DAYS = 14;

export interface FollowUpContext {
  lead: Lead;
  score: LeadScore | null;
  audit: WebsiteAudit | null;
  contact: Contact | null;
  replies: ReplyEvent[];
  /** Which follow-up is being considered. */
  sequence: 1 | 2;
  /** Sent drafts PLUS follow-ups already awaiting approval — total touches committed. */
  priorTouchCount: number;
}

/**
 * Decides whether a follow-up may be drafted. Every skip is a named reason —
 * bad/weak leads, replies of any decisive kind, bounces, max touches, or no
 * real improvement angle all end the sequence quietly. DNC/unsubscribe is
 * screened separately (and again at send) via screenForContactability; spam
 * complaints arrive as unsubscribe webhooks and land in the same screen.
 * Corporate/franchise fit is captured by the score tier (small/local signals).
 */
export function evaluateFollowUp(ctx: FollowUpContext): { eligible: boolean; skipReasons: string[] } {
  const skipReasons: string[] = [];
  if (ctx.lead.status !== "contacted") {
    skipReasons.push(`lead status is '${ctx.lead.status}' — follow-ups only chase silence after a send`);
  }
  const tier = ctx.score?.tier;
  if (tier !== "hot" && tier !== "warm") {
    skipReasons.push(`score tier '${tier ?? "none"}' — weak/bad leads get no follow-up`);
  } else if (ctx.sequence === 2 && tier !== "hot") {
    skipReasons.push("medium-strength (warm) leads get one follow-up only");
  }
  if (!ctx.audit || ctx.audit.outreachAngles.length === 0) {
    skipReasons.push("no real website-improvement angle from the audit");
  }
  if (!ctx.contact?.email) {
    skipReasons.push("no email contact path");
  } else if (ctx.contact.verification === "invalid") {
    skipReasons.push("contact email bounced/invalid");
  }
  // Any decisive reply ends the sequence: positive/neutral are handled by the
  // owner, negative means they said no, unsubscribe/bounce are absolute.
  // Auto-replies (out of office) don't count as a response.
  const decisive = ctx.replies.filter((r) => r.intent !== "auto_reply");
  if (decisive.length > 0) {
    skipReasons.push(`lead already replied (${decisive[0]!.intent}) — never bump a human who answered`);
  }
  if (ctx.priorTouchCount >= MAX_TOUCHES) {
    skipReasons.push(`already committed ${ctx.priorTouchCount} touches (max ${MAX_TOUCHES})`);
  }
  return { eligible: skipReasons.length === 0, skipReasons };
}

export interface FollowUpDraftInput {
  lead: Lead;
  company: Company;
  contact: Contact;
  audit: WebsiteAudit;
  sequence: 1 | 2;
  traceId: string;
}

/**
 * Polite, short follow-up. Same truthful finding, same free-mockup offer,
 * easy to say yes (or no). Passes the same validateDraft content rules as
 * first touch — opt-out line included, always.
 */
export function createFollowUpDraft(input: FollowUpDraftInput): OutreachDraft {
  const { lead, company, contact, audit, sequence } = input;
  const firstName = contact.name?.split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : `Hi there,`;
  const angle = audit.outreachAngles[0];

  const body =
    sequence === 1
      ? [
          greeting,
          "",
          `Just wanted to bump this in case it got buried — I know how busy things get.`,
          "",
          `I'm Will, a Cornell student${angle ? `, and I noticed ${angle}` : ""}. I've already built a free mockup of what a faster, mobile-friendly site for ${company.name} could look like — happy to send it over, no strings attached.`,
          "",
          `Want a look?`,
          "",
          `Best,`,
          `Will`,
          `williamdamato.com`,
          "",
          OPT_OUT_LINE,
        ].join("\n")
      : [
          greeting,
          "",
          `Last note from me, promise. The free mockup offer for ${company.name} still stands if you'd like a look — as a Cornell student I'd genuinely value hearing what you think, even if the answer is "not for us."`,
          "",
          `Either way, wishing you a busy season.`,
          "",
          `Best,`,
          `Will`,
          `williamdamato.com`,
          "",
          OPT_OUT_LINE,
        ].join("\n");

  let subject =
    sequence === 1 ? `re: quick idea for ${company.name}'s website` : `closing the loop — ${company.name}`;
  if (subject.length > 70) subject = sequence === 1 ? "re: a quick website idea" : "closing the loop";

  const now = nowIso();
  return {
    id: newId("odft"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    contactId: contact.id,
    variant: `followup-${sequence}`,
    subject,
    body,
    personalizationNotes: [
      `follow-up #${sequence} (no response)`,
      ...(angle ? [`reused audit angle: ${angle}`] : []),
      ...(firstName ? [`greeted by first name (${firstName})`] : ["generic greeting"]),
    ],
    auditFindingsUsed: angle ? [angle] : [],
    status: "draft",
    approvalRequestId: null,
    sentAt: null,
    traceId: input.traceId,
  };
}

/** Which follow-up (if any) a just-sent draft should schedule next. */
export function nextFollowUp(sentVariant: string): (typeof FOLLOW_UP_SCHEDULE)[number] | null {
  const current = sentVariant.startsWith("followup-") ? Number(sentVariant.slice("followup-".length)) : 0;
  return FOLLOW_UP_SCHEDULE.find((s) => s.sequence === current + 1) ?? null;
}
