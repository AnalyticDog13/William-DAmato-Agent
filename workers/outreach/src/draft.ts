import {
  newId,
  nowIso,
  type Company,
  type Contact,
  type Lead,
  type OutreachDraft,
  type WebsiteAudit,
} from "@william/core";

/** The exact opt-out line every first-touch email must contain (CHANGE_COMPLIANCE_TEXT gate protects edits). */
export const OPT_OUT_LINE = `Reply "I'm not interested" and you won't hear from me again.`;

const NICHE_HOOKS: Record<string, string> = {
  barbershop: "I help barbershops get found and booked online",
  fashion: "I help fashion brands look as sharp online as their pieces do",
  photographer: "I help photographers turn portfolios into inquiries",
  coffee_shop: "I help coffee shops turn foot traffic into regulars",
  restaurant: "I help restaurants fill more tables from search",
  other: "I help local businesses win more customers online",
};

export interface DraftInput {
  lead: Lead;
  company: Company;
  contact: Contact;
  audit: WebsiteAudit;
  variant?: string;
  traceId: string;
}

/**
 * First-touch copy variants the experiment engine may assign. v1 is the
 * default; every variant must satisfy validateDraft (opt-out line, Cornell
 * mention, mockup offer, length caps). The "already built a free mockup"
 * claim is owner-specified wording (compliance advisory B1) — keep verbatim.
 */
export const FIRST_TOUCH_VARIANTS = ["v1-cornell-mockup", "v2-finding-first"] as const;

/**
 * Personalized, truthful first-touch draft. Rules (per owner spec):
 * short, niche-aware, mentions being a Cornell student, cites REAL audit
 * findings only, offers an already-built free mockup, includes the opt-out
 * line, professional-yet-friendly tone.
 */
export function createFirstTouchDraft(input: DraftInput): OutreachDraft {
  const { lead, company, contact, audit } = input;
  const firstName = contact.name?.split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : `Hi there,`;
  const hook = NICHE_HOOKS[lead.niche] ?? NICHE_HOOKS.other!;

  const requested = input.variant ?? FIRST_TOUCH_VARIANTS[0];
  // Unknown variant must never kill the pipeline mid-draft: fall back to v1.
  const variant = (FIRST_TOUCH_VARIANTS as readonly string[]).includes(requested)
    ? requested
    : FIRST_TOUCH_VARIANTS[0];

  // Only claim what the audit actually found.
  const angles = audit.outreachAngles.slice(0, 2);
  const findingLine =
    angles.length > 0
      ? `I took a look at ${audit.hasWebsite ? `your site (${lead.domain})` : `your online presence`} and noticed ${formatAngles(angles)}.`
      : `I took a quick look at how ${company.name} shows up online and think there's real room to win more customers.`;

  const mockupOffer = `I've already built a free mockup of what a faster, mobile-friendly site for ${company.name} could look like — happy to send it over, no strings attached. If you like it, great; if not, you keep the ideas.`;
  const signOff = [`Worth a look?`, "", `Best,`, `Will`, `williamdamato.com`, "", OPT_OUT_LINE];

  let subject: string;
  let body: string;
  if (variant === "v2-finding-first") {
    // Finding-led: the observation opens, the introduction follows.
    const proposed = audit.hasWebsite
      ? `noticed something on ${company.name}'s site`
      : `a quick website idea for ${company.name}`;
    subject = proposed.length <= 70 ? proposed : audit.hasWebsite ? "noticed something on your site" : "a quick website idea";
    body = [
      greeting,
      "",
      findingLine,
      "",
      `I'm Will — a Cornell student, and ${hook}. ${mockupOffer}`,
      "",
      ...signOff,
    ].join("\n");
  } else {
    subject = audit.hasWebsite
      ? `quick idea for ${company.name}'s website`
      : `a website idea for ${company.name}`;
    body = [
      greeting,
      "",
      `I'm Will — a Cornell student, and ${hook}. ${findingLine}`,
      "",
      mockupOffer,
      "",
      ...signOff,
    ].join("\n");
  }

  const now = nowIso();
  return {
    id: newId("odft"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    contactId: contact.id,
    variant,
    subject,
    body,
    personalizationNotes: [
      `niche hook: ${lead.niche}`,
      ...(firstName ? [`greeted by first name (${firstName})`] : ["no contact name available — generic greeting"]),
      ...(variant !== requested ? [`unknown variant "${requested}" requested — fell back to ${variant}`] : []),
    ],
    auditFindingsUsed: angles,
    status: "draft",
    approvalRequestId: null,
    sentAt: null,
    traceId: input.traceId,
  };
}

/** The post-ship delivery email variant (shares the live link, offers a call). */
export const DELIVERY_VARIANT = "delivery-1";

export interface DeliveryDraftInput {
  lead: Lead;
  company: Company;
  contact: Contact;
  /** The live site URL (or a dry-run placeholder) to share. */
  liveUrl: string | null;
  traceId: string;
}

/**
 * Delivery email sent after the owner ships the finished site. Still gated by
 * SEND_FIRST_TOUCH (same outbound-email risk class) and owner-approved, so it
 * must pass validateDraft: it references the earlier free mockup (now a real
 * live site), keeps the Cornell intro, and carries the opt-out line.
 */
export function createDeliveryDraft(input: DeliveryDraftInput): OutreachDraft {
  const { lead, company, contact, liveUrl } = input;
  const firstName = contact.name?.split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : `Hi there,`;
  const link = liveUrl ?? "(link to follow)";
  const now = nowIso();
  const body = [
    greeting,
    "",
    `Great news — the free mockup I shared for ${company.name} is now a real, live website: ${link}`,
    "",
    `I'm Will, the Cornell student who reached out. Take it for a spin on your phone and desktop — if you'd like any tweaks, or want to hop on a quick call to go over it, just reply and I'll sort it out.`,
    "",
    `Best,`,
    `Will`,
    `williamdamato.com`,
    "",
    OPT_OUT_LINE,
  ].join("\n");

  return {
    id: newId("odft"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    contactId: contact.id,
    variant: DELIVERY_VARIANT,
    subject: `${company.name}'s new website is live`.slice(0, 70),
    body,
    personalizationNotes: [`delivery email`, ...(firstName ? [`greeted by first name (${firstName})`] : [])],
    auditFindingsUsed: [],
    status: "draft",
    approvalRequestId: null,
    sentAt: null,
    traceId: input.traceId,
  };
}

function formatAngles(angles: string[]): string {
  if (angles.length === 1) return angles[0]!;
  return `${angles[0]} — and ${angles[1]}`;
}

/** Hard rules a draft must satisfy before it may even be queued for approval. */
export function validateDraft(draft: OutreachDraft): string[] {
  const problems: string[] = [];
  if (!draft.body.includes(OPT_OUT_LINE)) problems.push("missing opt-out line");
  if (!/cornell/i.test(draft.body)) problems.push("missing Cornell student mention");
  if (!/mockup/i.test(draft.body)) problems.push("missing free-mockup offer");
  if (draft.body.length > 1200) problems.push(`too long (${draft.body.length} chars; keep it short)`);
  if (draft.subject.length > 70) problems.push("subject too long");
  return problems;
}
