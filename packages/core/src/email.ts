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
  "sentry.io",
  "wixpress.com",
  "sentry-next.wixpress.com", // Wix/Sentry telemetry domain that leaks into page source
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

const ASSET_TAIL_RE = /\.(png|jpg|jpeg|gif|webp|svg|css|js)$/;

/** True when an address is a known placeholder or sits on a placeholder domain. */
export function isPlaceholderEmail(email: string): boolean {
  const e = email.toLowerCase();
  if (PLACEHOLDER_EMAILS.has(e)) return true;
  const domain = e.split("@")[1] ?? "";
  return PLACEHOLDER_DOMAINS.has(domain);
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
