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

/** Friendly P.S. opt-out — compliance text validateDraft enforces. Comma, no emdash. */
export const OPT_OUT_LINE = `P.S. If you'd rather not hear from me, just say the word and I'll take you off my list right away, no hard feelings!`;

export interface DraftInput {
  lead: Lead;
  company: Company;
  contact: Contact;
  audit: WebsiteAudit;
  traceId: string;
}

/** The single first-touch variant id (experiments removed). */
export const FIRST_TOUCH_VARIANT = "v1-cornell-mockup";

function joinAngles(angles: string[]): string {
  if (angles.length === 0) return "";
  if (angles.length === 1) return angles[0]!;
  return `${angles[0]} and ${angles[1]}`;
}

/**
 * Short, human first-touch email. Rules (owner spec):
 * - body <= 5 sentences (greeting, sign-off, P.S. excluded from count)
 * - no emdash / en-dash / double-dash
 * - mentions being a Cornell student
 * - cites REAL audit findings only (no invented claims)
 * - offers an already-built free mockup
 * - friendly P.S. opt-out (OPT_OUT_LINE)
 * - no URL (website revealed only after the prospect replies)
 */
export function createFirstTouchDraft(input: DraftInput): OutreachDraft {
  const { lead, company, contact, audit } = input;
  const firstName = contact.name?.split(/\s+/)[0];
  const greeting = firstName ? `Dear ${firstName},` : `Hi there,`;
  const niche = NICHE_META[lead.niche].label.toLowerCase();
  const place = company.city ? `${company.city} ${niche}` : `local ${niche}`;

  const angles = audit.outreachAngles.slice(0, 2);
  const finding =
    angles.length > 0
      ? `I noticed ${joinAngles(angles)}, which probably costs you a few customers`
      : `I think a few quick changes could help you get more customers from your site`;

  let body = [
    greeting,
    "",
    `I'm Will, a student at Cornell, and I came across ${company.name} while looking at ${place} sites. ${finding}. I actually put together a quick mockup of how it could look, and I'd be happy to send it over if you want a peek. Either way, no worries at all if now's not a good time.`,
    "",
    `Thanks,`,
    `Will`,
    "",
    OPT_OUT_LINE,
  ].join("\n");
  // Sanitize: audit angles or company.name may contain emdashes/en-dashes/double-dashes.
  // Replace them so validateDraft never rejects a legitimate draft due to source-data punctuation.
  // The OPT_OUT_LINE has no dash characters, so it is preserved verbatim.
  body = body.replace(/\s*(?:—|–|--)\s*/g, ", ");

  const now = nowIso();
  return {
    id: newId("odft"),
    createdAt: now,
    updatedAt: now,
    leadId: lead.id,
    contactId: contact.id,
    variant: FIRST_TOUCH_VARIANT,
    subject: `quick note about ${company.name}'s website`.slice(0, 70),
    body,
    personalizationNotes: [
      `niche: ${lead.niche}`,
      ...(firstName
        ? [`greeted by first name (${firstName})`]
        : ["no contact name — generic greeting"]),
    ],
    auditFindingsUsed: angles,
    status: "draft",
    approvalRequestId: null,
    sentAt: null,
    traceId: input.traceId,
  };
}

/**
 * Detects a website link/URL in copy: an explicit http(s):// or www. prefix, or
 * a bare `word.tld` token on a common TLD. Used to keep links OUT of outreach.
 * (Email addresses are not URLs; the templates contain none.)
 */
const URL_IN_COPY_RE =
  /(https?:\/\/|www\.[a-z0-9-]|\b[a-z0-9-]+\.(?:com|net|org|io|co|shop|store|app|dev|biz|us|cafe|site|online|xyz)\b)/i;

/**
 * Count sentences in the MESSAGE body — excludes the greeting line, sign-off
 * lines ("Thanks,", "Will"), and the P.S. opt-out. Used by validateDraft to
 * enforce the 5-sentence cap.
 */
export function countMessageSentences(body: string): number {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const content = lines.filter(
    (l) =>
      !/^(hi|hey|dear|hello)\b/i.test(l) &&
      !/^(thanks|best|cheers|regards|sincerely),?$/i.test(l) &&
      !/^will$/i.test(l) &&
      !/^p\.?s\.?/i.test(l),
  );
  return (content.join(" ").match(/[.!?](\s|$)/g) ?? []).length;
}

/** Hard rules a draft must satisfy before it may even be queued for approval. */
export function validateDraft(draft: OutreachDraft): string[] {
  const problems: string[] = [];
  if (!draft.body.includes(OPT_OUT_LINE)) problems.push("missing opt-out line");
  if (!/cornell/i.test(draft.body)) problems.push("missing Cornell student mention");
  if (!/mockup/i.test(draft.body)) problems.push("missing free-mockup offer");
  if (/[—–]|--/.test(draft.body)) problems.push("contains an emdash");
  if (countMessageSentences(draft.body) > 5) problems.push("body too long (>5 sentences)");
  if (draft.subject.length > 70) problems.push("subject too long");
  // Outreach must NOT contain a link — the mockup/website is revealed only
  // after the prospect engages.
  if (URL_IN_COPY_RE.test(draft.body)) {
    problems.push("must not include a link/URL (the website is shared only after they reply)");
  }
  return problems;
}
