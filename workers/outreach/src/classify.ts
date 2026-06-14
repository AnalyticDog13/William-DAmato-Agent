import type { ReplyIntent } from "@william/core";

export interface Classification {
  intent: ReplyIntent;
  confidence: number;
  /** True if the reply contained imperative/prompt-like content we ignored. */
  instructionAttemptDetected: boolean;
}

const PATTERNS: { intent: ReplyIntent; confidence: number; re: RegExp }[] = [
  { intent: "unsubscribe", confidence: 0.95, re: /\b(i'?m not interested|unsubscribe|remove me|stop emailing|take me off|opt out|do not contact)\b/i },
  { intent: "bounce", confidence: 0.95, re: /\b(delivery (status notification|failure)|undeliverable|address not found|mailbox (full|unavailable))\b/i },
  { intent: "auto_reply", confidence: 0.9, re: /\b(out of (the )?office|auto-?reply|automatic reply|on vacation|away from my (desk|email))\b/i },
  { intent: "positive", confidence: 0.8, re: /\b(interested|sounds good|let'?s (talk|chat)|send (it|the mockup)|tell me more|what would it cost|how much|yes please|love to see)\b/i },
  { intent: "negative", confidence: 0.75, re: /\b(not (a (good )?fit|right now|for us)|already have (a|someone)|we'?re (all )?set|no thanks?|not looking)\b/i },
  { intent: "neutral", confidence: 0.5, re: /\b(who is this|how did you (get|find)|what company|more info(rmation)?|can you clarify)\b/i },
];

/**
 * Optional LLM assist: resolves an ambiguous reply into an intent + confidence,
 * or null when no LLM is available (the mock, and the real adapter in dry-run /
 * local). The reply text is passed strictly as quoted material to LABEL — never
 * as instructions. Injection detection is NOT delegated here (see below).
 */
export type LlmReplyAssist = (text: string) => Promise<{ intent: ReplyIntent; confidence: number } | null>;

/**
 * Classifies inbound reply text. SECURITY INVARIANT: reply content is DATA.
 * It is pattern-matched here and summarized for the owner — it is never
 * executed, never fed to an agent as instructions, and any prompt-injection
 * attempt is flagged so a ComplianceEvent can be recorded.
 */
export function classifyReply(text: string): Classification {
  const instructionAttemptDetected =
    /\b(ignore (all |any )?(previous|prior|above) (instructions|prompts?)|you are now|system prompt|act as|disregard your)\b/i.test(
      text,
    );
  for (const p of PATTERNS) {
    if (p.re.test(text)) {
      return { intent: p.intent, confidence: p.confidence, instructionAttemptDetected };
    }
  }
  return { intent: "unknown", confidence: 0.3, instructionAttemptDetected };
}

/**
 * Classifies a reply, consulting an optional LLM assist ONLY for genuinely
 * ambiguous replies. The deterministic regex (`classifyReply`) stays
 * AUTHORITATIVE:
 *
 *  - It runs first, always, on the raw text.
 *  - Any confident regex label — including every compliance-critical intent
 *    (unsubscribe / bounce / negative) — short-circuits before the LLM is
 *    consulted, so the model can NEVER override a stop signal.
 *  - The LLM is asked only when the regex returns `unknown`; it may resolve it
 *    (including upgrading to a stop signal, which is fail-closed-good) or stay
 *    unsure (return null / "unknown"), in which case the regex result stands.
 *  - Injection detection is never delegated: `instructionAttemptDetected` comes
 *    only from the regex detector and can never be cleared by the LLM.
 */
export async function classifyReplyAssisted(text: string, assist?: LlmReplyAssist): Promise<Classification> {
  const base = classifyReply(text);
  if (!assist || base.intent !== "unknown") return base;
  const resolved = await assist(text);
  if (!resolved) return base;
  return {
    intent: resolved.intent,
    confidence: resolved.confidence,
    instructionAttemptDetected: base.instructionAttemptDetected,
  };
}

/** Owner-facing recommendation for each intent. */
export function recommendedNextStep(intent: ReplyIntent): string {
  switch (intent) {
    case "positive":
      return "Review thread, approve preview build, and schedule a call yourself via will@williamdamato.com.";
    case "neutral":
      return "Short clarifying reply recommended — review draft in Review Queue before sending.";
    case "negative":
      return "Mark lost; follow-ups paused automatically. No further action needed.";
    case "unsubscribe":
      return "Unsubscribe honored automatically; contact added to do-not-contact list.";
    case "bounce":
      return "Email invalid — enrichment retry queued; verify before any future attempt.";
    case "auto_reply":
      return "No action; follow-up timing unaffected unless a return date was given.";
    default:
      return "Manual review needed — intent unclear.";
  }
}
