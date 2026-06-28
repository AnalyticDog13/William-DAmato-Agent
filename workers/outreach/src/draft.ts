import {
  newId,
  nowIso,
  NICHE_META,
  type Company,
  type Contact,
  type Lead,
  type OutreachDraft,
  type WebsiteAudit,
} from "@william/core";

/** The exact opt-out line every first-touch email must contain (CHANGE_COMPLIANCE_TEXT gate protects edits). */
export const OPT_OUT_LINE = `Reply "I'm not interested" and you won't hear from me again.`;

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
  const hook = NICHE_META[lead.niche].outreachHook;

  const requested = input.variant ?? FIRST_TOUCH_VARIANTS[0];
  // Unknown variant must never kill the pipeline mid-draft: fall back to v1.
  const variant = (FIRST_TOUCH_VARIANTS as readonly string[]).includes(requested)
    ? requested
    : FIRST_TOUCH_VARIANTS[0];

  // Only claim what the audit actually found.
  const angles = audit.outreachAngles.slice(0, 2);
  const findingLine =
    angles.length > 0
      ? `I took a look at ${audit.hasWebsite ? `your site` : `your online presence`} and noticed ${formatAngles(angles)}.`
      : `I took a quick look at how ${company.name} shows up online and think there's real room to win more customers.`;

  // No link in outreach — we tease that the mockup is already built and share
  // the website only after they reply. validateDraft enforces the no-URL rule.
  const mockupOffer = `I've already built a free mockup of what a faster, mobile-friendly site for ${company.name} could look like — happy to send it over, no strings attached. If you like it, great; if not, you keep the ideas.`;
  const signOff = [`Worth a look?`, "", `Best,`, `Will`, "", OPT_OUT_LINE];

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

function formatAngles(angles: string[]): string {
  if (angles.length === 1) return angles[0]!;
  return `${angles[0]} — and ${angles[1]}`;
}

/**
 * Detects a website link/URL in copy: an explicit http(s):// or www. prefix, or
 * a bare `word.tld` token on a common TLD. Used to keep links OUT of outreach.
 * (Email addresses are not URLs; the templates contain none.)
 */
const URL_IN_COPY_RE = /(https?:\/\/|www\.[a-z0-9-]|\b[a-z0-9-]+\.(?:com|net|org|io|co|shop|store|app|dev|biz|us|cafe|site|online|xyz)\b)/i;

/** Hard rules a draft must satisfy before it may even be queued for approval. */
export function validateDraft(draft: OutreachDraft): string[] {
  const problems: string[] = [];
  if (!draft.body.includes(OPT_OUT_LINE)) problems.push("missing opt-out line");
  if (!/cornell/i.test(draft.body)) problems.push("missing Cornell student mention");
  if (!/mockup/i.test(draft.body)) problems.push("missing free-mockup offer");
  if (draft.body.length > 1200) problems.push(`too long (${draft.body.length} chars; keep it short)`);
  if (draft.subject.length > 70) problems.push("subject too long");
  // Outreach must NOT contain a link — the mockup/website is revealed only
  // after the prospect engages.
  if (URL_IN_COPY_RE.test(draft.body)) {
    problems.push("must not include a link/URL (the website is shared only after they reply)");
  }
  return problems;
}
