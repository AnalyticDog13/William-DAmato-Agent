/** Page-source addresses that are template placeholders, not real business contacts. */
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

/** Domains that never belong to a real prospect (templates, CMS noise, telemetry). */
export const PLACEHOLDER_DOMAINS: ReadonlySet<string> = new Set([
  "example.com",
  "example.org",
  "example.net",
  "yourdomain.com",
  "domain.com",
  "email.com",
  "sentry.io",
  "wixpress.com",
]);

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
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
  const found = text.match(EMAIL_RE) ?? [];
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
