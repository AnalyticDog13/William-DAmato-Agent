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

  // Only claim what the audit actually found.
  const angles = audit.outreachAngles.slice(0, 2);
  const findingLine =
    angles.length > 0
      ? `I took a look at ${audit.hasWebsite ? `your site (${lead.domain})` : `your online presence`} and noticed ${formatAngles(angles)}.`
      : `I took a quick look at how ${company.name} shows up online and think there's real room to win more customers.`;

  const subject = audit.hasWebsite
    ? `quick idea for ${company.name}'s website`
    : `a website idea for ${company.name}`;

  const body = [
    greeting,
    "",
    `I'm Will — a Cornell student, and ${hook}. ${findingLine}`,
    "",
    `I've already built a free mockup of what a faster, mobile-friendly site for ${company.name} could look like — happy to send it over, no strings attached. If you like it, great; if not, you keep the ideas.`,
    "",
    `Worth a look?`,
    "",
    `Best,`,
    `Will`,
    `williamdamato.com`,
    "",
    OPT_OUT_LINE,
  ].join("\n");

  const now = nowIso();
  return {
    id: newId("odft"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    contactId: contact.id,
    variant: input.variant ?? "v1-cornell-mockup",
    subject,
    body,
    personalizationNotes: [
      `niche hook: ${lead.niche}`,
      ...(firstName ? [`greeted by first name (${firstName})`] : ["no contact name available — generic greeting"]),
    ],
    auditFindingsUsed: angles,
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
