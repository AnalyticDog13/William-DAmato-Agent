import { newId, type PolicyTicket } from "@william/core";
import type { ExecutionResult } from "../types";

/**
 * Shared plumbing for REAL adapters. The two invariants every real adapter
 * must uphold (same contract as the mocks):
 *   1. No PolicyTicket → throw. Tickets only come from the PolicyEngine.
 *   2. ticket.dryRun → simulate and return; the network is never touched.
 */

export interface RealDeps {
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export function requireTicket(ticket: PolicyTicket, action: string): void {
  if (!ticket?.__policyTicket) {
    throw new Error(`SECURITY: ${action} called without a PolicyTicket — this is a bug.`);
  }
}

/** Honest dry-run result from a real adapter: clearly NOT executed. */
export function simulatedReal(adapter: string, action: string, detail: string, prefix: string): ExecutionResult {
  return {
    dryRun: true,
    ok: true,
    externalId: newId(prefix),
    detail: `[REAL:${adapter}/DRY-RUN] ${action} simulated: ${detail}`,
  };
}

/** Fetch + parse with uniform failure shape; adapters never throw on HTTP errors. */
export async function callJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown>; text: string }> {
  try {
    const res = await fetchImpl(url, init);
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // non-JSON response body; text retained for error detail
    }
    return { ok: res.ok, status: res.status, body, text };
  } catch (err) {
    return { ok: false, status: 0, body: {}, text: err instanceof Error ? err.message : String(err) };
  }
}

export function failure(action: string, status: number, text: string): ExecutionResult {
  // Scrub key-shaped fragments (e.g. Stripe echoes a redacted sk_ prefix in
  // auth errors) — failure details land in lead-visible records.
  const scrubbed = text.replace(/\b(sk|rk|whsec|pk)_[A-Za-z0-9_*.]+/g, "[redacted-key]");
  return { dryRun: false, ok: false, detail: `${action} failed (HTTP ${status}): ${scrubbed.slice(0, 300)}` };
}

/** application/x-www-form-urlencoded body (Stripe, OAuth token endpoints). */
export function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}
