/**
 * Normalization + identity keys used for deduplication and DNC screening.
 * Dedupe identity: normalized domain, normalized email, and company identity
 * (name slug + locality) — a lead is a duplicate if ANY identity key matches.
 */

export function normalizeDomain(input: string): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  try {
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
    const url = new URL(s);
    let host = url.hostname;
    if (host.startsWith("www.")) host = host.slice(4);
    if (!host.includes(".")) return null;
    return host;
  } catch {
    return null;
  }
}

export function normalizeEmail(input: string): string | null {
  const s = input.trim().toLowerCase();
  // Pragmatic shape check; real deliverability is the verifier's job.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return null;
  return s;
}

export function companySlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/\b(llc|inc|co|corp|ltd|company)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function companyIdentityKey(name: string, city?: string | null): string {
  const slug = companySlug(name);
  const locality = (city ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return locality ? `${slug}@${locality}` : slug;
}

export interface LeadIdentity {
  domain?: string | null;
  email?: string | null;
  companyKey?: string | null;
}

/** Keys under which a lead is registered / looked up for dedupe. */
export function identityKeys(identity: LeadIdentity): string[] {
  const keys: string[] = [];
  if (identity.domain) keys.push(`domain:${identity.domain}`);
  if (identity.email) keys.push(`email:${identity.email}`);
  if (identity.companyKey) keys.push(`company:${identity.companyKey}`);
  return keys;
}
