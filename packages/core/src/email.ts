/** Page-source addresses that are template placeholders, not real business contacts.
 *
 * NOTE: we filter by DOMAIN (below) and by these exact placeholder addresses —
 * NEVER by the local-part. `info@`, `contact@`, `team@`, `hello@`, `sales@`,
 * `bookings@` etc. on a REAL business domain (e.g. info@corner-roasters.co) are
 * perfectly valid contacts and must be KEPT. Only the fake-domain variants
 * (info@example.com, contact@info.com) are placeholders. */
export const PLACEHOLDER_EMAILS: ReadonlySet<string> = new Set([
  "info@example.com",
  "contact@info.com",
  "info@contact.com",
  "hello@contact.com",
  "hello@example.com",
  "email@example.com",
  "name@example.com",
  "you@example.com",
]);

/** Domains that never belong to a real prospect (templates, CMS noise, telemetry).
 *  This is the primary placeholder signal — a fake/template DOMAIN, not the
 *  address prefix. */
export const PLACEHOLDER_DOMAINS: ReadonlySet<string> = new Set([
  "example.com",
  "example.org",
  "example.net",
  "yourdomain.com",
  "your-domain.com",
  "domain.com",
  "email.com",
  "info.com",
  "contact.com",
  "test.com",
  "sample.com",
  "mysite.com",
  "website.com",
  "yourwebsite.com",
  "company.com",
  "business.com",
  // (wixpress.com / sentry.io live in PLACEHOLDER_DOMAIN_SUFFIXES below — they
  //  leak via SUBDOMAINS, so they need suffix matching, not an exact entry.)
  // Theme/CMS/store-builder demo & placeholder domains. These appear verbatim in
  // unconfigured Shopify/Wix/Squarespace/WordPress themes (e.g. a leftover
  // `info@mystore.com` in the source) and must NEVER be treated as a real
  // prospect's contact. Real email providers (gmail.com, outlook.com, a real
  // custom domain, etc.) are deliberately NOT listed.
  "mystore.com", // Shopify default/demo store domain
  "yourstore.com",
  "your-store.com",
  "storename.com",
  "yourcompany.com",
  "your-company.com",
  "mycompany.com",
  "companyname.com",
  "yourbusiness.com",
  "your-business.com",
  "mybusiness.com",
  "yourbrand.com",
  "mybrand.com",
  "brandname.com",
  "mywebsite.com",
  "youremail.com",
  "your-email.com",
  "demo.com",
  "placeholder.com",
  "acme.com",
  "johndoe.com",
  "janedoe.com",
  "dummy.com",
  "loremipsum.com",
  "mailinator.com", // disposable inbox
  "no-reply.com",
  "noreply.com",
]);

/** Telemetry / CMS-noise domains that leak into page source via SUBDOMAINS
 *  (e.g. Wix's `sentry.wixpress.com`, `sentry-next.wixpress.com`; Sentry's
 *  `o123.ingest.sentry.io`). Matched by SUFFIX so one entry covers every
 *  current and future subdomain — no more whack-a-mole adding each one. Kept
 *  separate from the exact set above so the codebase's `*.example.com` test
 *  fixtures (real-business stand-ins) are NOT swept up. */
export const PLACEHOLDER_DOMAIN_SUFFIXES: ReadonlySet<string> = new Set([
  "wixpress.com",
  "sentry.io",
]);

const ASSET_TAIL_RE = /\.(png|jpg|jpeg|gif|webp|svg|css|js)$/;

/** True when an address is a known placeholder, sits on an exact placeholder
 *  domain, or sits on a telemetry-noise domain OR ANY of its subdomains.
 *  Suffix matching (on a label boundary) is what kills the recurring leaks:
 *  `wixpress.com` covers `sentry.wixpress.com`, `sentry-next.wixpress.com`, and
 *  any future `*.wixpress.com` without a new entry. The leading-dot boundary keeps
 *  it safe — `myemail.com` does NOT match `email.com`. */
export function isPlaceholderEmail(email: string): boolean {
  const e = email.toLowerCase();
  if (PLACEHOLDER_EMAILS.has(e)) return true;
  const domain = e.split("@")[1] ?? "";
  if (!domain) return false;
  if (PLACEHOLDER_DOMAINS.has(domain)) return true; // exact: templates appear verbatim
  for (const bad of PLACEHOLDER_DOMAIN_SUFFIXES) {
    if (domain === bad || domain.endsWith("." + bad)) return true; // suffix: telemetry subdomains
  }
  return false;
}

/** All plausible emails in free text: lowercased, deduped, asset-shaped matches removed. */
export function extractEmails(text: string): string[] {
  const found = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  const out = new Set<string>();
  for (const raw of found) {
    const e = raw.toLowerCase();
    if (ASSET_TAIL_RE.test(e)) continue;
    out.add(e);
  }
  return [...out];
}

/** First address that is not a placeholder, or null. */
export function firstRealEmail(emails: string[]): string | null {
  for (const e of emails) if (!isPlaceholderEmail(e)) return e.toLowerCase();
  return null;
}

// ─── Ranked business-email selection ────────────────────────────────────────
// Picking the FIRST non-placeholder email (firstRealEmail) grabbed whatever
// appeared earliest in the page source — often a third-party/raw-HTML address,
// not the real service contact. bestBusinessEmail ranks candidates so the
// company's own service address wins, and demotes no-reply/system addresses.

/** Role/service local-parts a real prospect uses for a monitored inbox. */
const ROLE_LOCALPARTS: ReadonlySet<string> = new Set([
  "info", "contact", "hello", "hi", "sales", "service", "support", "office",
  "admin", "team", "bookings", "booking", "book", "enquiries", "enquiry",
  "inquiries", "inquiry", "quote", "quotes", "estimate", "estimates", "help",
  "mail", "general", "reception", "accounts", "billing",
]);

/** System/automated local-parts that can't (or shouldn't) receive outreach. */
const SYSTEM_LOCALPARTS: ReadonlySet<string> = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "donot-reply",
  "postmaster", "mailer-daemon", "mailerdaemon", "webmaster", "hostmaster",
  "abuse", "privacy", "legal", "dmca", "unsubscribe", "bounce",
  "notifications", "notification", "automated", "auto", "root",
]);

/** Consumer mailbox providers — a company-named address here is a real contact. */
const FREE_PROVIDERS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "zoho.com",
]);

export interface BusinessEmailContext {
  /** The lead's website URL — its host (minus `www.`) is the "company domain". */
  siteUrl?: string | null;
  /** The business name — used to match a company-named free-provider address. */
  companyName?: string | null;
}

function siteDomain(siteUrl?: string | null): string | null {
  if (!siteUrl) return null;
  try {
    const host = new URL(siteUrl.includes("://") ? siteUrl : `https://${siteUrl}`).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const normalizeToken = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const emailLocal = (e: string): string => (e.split("@")[0] ?? "").split("+")[0] ?? "";
const emailDomain = (e: string): string => e.split("@")[1] ?? "";

/** Distinct tokens (≥4 chars) that a company-named mailbox would contain. */
function companyTokens(domain: string | null, companyName?: string | null): string[] {
  const out = new Set<string>();
  if (domain) out.add(normalizeToken(domain.split(".")[0] ?? ""));
  if (companyName) out.add(normalizeToken(companyName));
  return [...out].filter((t) => t.length >= 4);
}

function onOwnDomain(emailDom: string, dom: string | null): boolean {
  return !!dom && (emailDom === dom || emailDom.endsWith("." + dom));
}

/** Higher = more likely the real business contact. Placeholders are excluded by the caller. */
function scoreEmail(email: string, dom: string | null, tokens: string[]): number {
  const local = emailLocal(email);
  const edom = emailDomain(email);
  const own = onOwnDomain(edom, dom);
  const role = ROLE_LOCALPARTS.has(local);
  if (SYSTEM_LOCALPARTS.has(local)) return own ? 15 : 1; // junk to the bottom
  if (own) return role ? 100 : 80; // own domain: role > anyone
  const normLocal = normalizeToken(local);
  // Company-named when the local-part contains a full company token
  // (easlandscaping@…) OR is a short PREFIX abbreviation of one (eas@… for
  // "EAS Landscaping"). The prefix rule avoids promoting an unrelated address
  // whose local merely happens to be a substring (e.g. "pro@" inside "plumbpro").
  const companyNamed = tokens.some(
    (t) => normLocal.includes(t) || (normLocal.length >= 3 && t.startsWith(normLocal)),
  );
  if (FREE_PROVIDERS.has(edom) && companyNamed) return 60; // company@gmail
  if (role) return 40; // role on some other domain
  return 20; // other non-placeholder (lenient fallback)
}

/**
 * Best business contact email from a list, ranked by likelihood it's the real
 * service inbox: role@own-domain > anyone@own-domain > company-named@free-provider
 * > role@other > other; no-reply/system addresses are pushed to the bottom and
 * placeholders are excluded. Returns the best available (lenient) or null if there
 * are no non-placeholder candidates. Ties keep input order.
 */
export function bestBusinessEmail(emails: string[], ctx: BusinessEmailContext = {}): string | null {
  const dom = siteDomain(ctx.siteUrl);
  const tokens = companyTokens(dom, ctx.companyName);
  let best: string | null = null;
  let bestScore = -1;
  for (const raw of emails) {
    const e = raw.toLowerCase();
    if (isPlaceholderEmail(e)) continue;
    const s = scoreEmail(e, dom, tokens);
    if (s > bestScore) {
      bestScore = s;
      best = e;
    }
  }
  return best;
}

/** True when `email` is a role address on the site's OWN domain — the best possible
 *  contact, so a crawler can stop early and the homepage pass can short-circuit. */
export function isTopTierContact(email: string, ctx: BusinessEmailContext = {}): boolean {
  const dom = siteDomain(ctx.siteUrl);
  if (!dom) return false;
  const e = email.toLowerCase();
  if (isPlaceholderEmail(e)) return false;
  return onOwnDomain(emailDomain(e), dom) && ROLE_LOCALPARTS.has(emailLocal(e));
}
