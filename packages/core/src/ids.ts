import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, lowercase

/**
 * Sortable unique id: 10 chars of millisecond timestamp + 16 chars randomness.
 * ULID-shaped so ids sort by creation time in the database and dashboard.
 */
export function newId(prefix: string): string {
  let ts = Date.now();
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[ts % 32] + time;
    ts = Math.floor(ts / 32);
  }
  const rand = randomBytes(16);
  let suffix = "";
  for (let i = 0; i < 16; i++) suffix += ALPHABET[rand[i]! % 32];
  return `${prefix}_${time}${suffix}`;
}

export function newTraceId(): string {
  return newId("trc");
}

export function nowIso(): string {
  return new Date().toISOString();
}
