import type { Store } from "@william/db";

export interface ScreenResult {
  blocked: boolean;
  reasons: string[];
}

/**
 * Absolute pre-send screen: do-not-contact and unsubscribe records win over
 * everything. Called at intake AND again immediately before any draft is
 * queued or synced — records may have appeared between the two.
 */
export function screenForContactability(
  store: Store,
  identityKeys: string[],
  email?: string | null,
): ScreenResult {
  const reasons: string[] = [];
  const keys = [...identityKeys];
  if (email) keys.push(`email:${email.toLowerCase()}`);
  for (const key of keys) {
    for (const rec of store.doNotContact.findByKey(key)) {
      reasons.push(`do-not-contact (${rec.identityKey}): ${rec.reason}`);
    }
    if (key.startsWith("email:")) {
      for (const u of store.unsubscribes.findByKey(key)) {
        reasons.push(`unsubscribed (${u.email}) via ${u.source}`);
      }
    }
  }
  return { blocked: reasons.length > 0, reasons };
}
