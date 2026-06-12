import { Router, raw } from "express";
import { newId, newTraceId, nowIso } from "@william/core";
import { hmacSignatureValid } from "@william/integrations";
import type { AppContext } from "@william/worker-orchestrator";

/**
 * Webhook ingestion (Instantly + Stripe). Signature verification first; the
 * payload is recorded, then mapped to queue jobs. Inbound content is DATA —
 * it can only ever enqueue the fixed reply/payment handlers, never arbitrary
 * actions. William can NEVER be prompted by email or webhook.
 */
export function webhookRoutes(ctx: AppContext): Router {
  const router = Router();

  router.post("/instantly", raw({ type: "*/*", limit: "256kb" }), (req, res) => {
    const rawBody = (req.body as Buffer | undefined)?.toString("utf8") ?? "";
    const signature = req.header("x-instantly-signature");
    const secret = process.env.INSTANTLY_WEBHOOK_SECRET;
    const verdict = verifySignature(ctx, "instantly", rawBody, signature, secret);
    if (!verdict.accept) {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawBody);
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    const eventType = String(event.event_type ?? event.type ?? "unknown");
    recordWebhook(ctx, "instantly", eventType, rawBody, verdict.signatureValid);

    const email = typeof event.lead_email === "string" ? event.lead_email.toLowerCase() : null;
    const contact = email ? ctx.store.contacts.findByKey(`email:${email}`)[0] : null;
    const leadId = contact?.leadId ?? null;
    if (leadId) {
      const traceId = newTraceId();
      const text = String(event.reply_text ?? event.reply_text_snippet ?? "");
      switch (eventType) {
        case "reply_received":
          ctx.store.queue.enqueue({ type: "reply.process", payload: { leadId, text, provider: "instantly", externalMessageId: event.email_id ?? null }, traceId, leadId });
          break;
        case "email_bounced":
          ctx.store.queue.enqueue({ type: "reply.process", payload: { leadId, text: "delivery failure: undeliverable", provider: "instantly" }, traceId, leadId });
          break;
        case "lead_unsubscribed":
          ctx.store.queue.enqueue({ type: "reply.process", payload: { leadId, text: "unsubscribe", provider: "instantly" }, traceId, leadId });
          break;
        default:
          // campaign updates etc. are recorded above; no pipeline action yet.
          break;
      }
    }
    res.json({ ok: true });
  });

  router.post("/stripe", raw({ type: "*/*", limit: "256kb" }), (req, res) => {
    const rawBody = (req.body as Buffer | undefined)?.toString("utf8") ?? "";
    const signature = req.header("stripe-signature");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    // TODO(phase-c): real Stripe signature scheme (t=...,v1=...) via stripe SDK.
    const verdict = verifySignature(ctx, "stripe", rawBody, signature, secret);
    if (!verdict.accept) {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawBody);
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    const eventType = String(event.type ?? "unknown");
    recordWebhook(ctx, "stripe", eventType, rawBody, verdict.signatureValid);

    if (eventType === "checkout.session.completed" || eventType === "invoice.paid") {
      const obj = (event.data as { object?: Record<string, unknown> } | undefined)?.object ?? {};
      const draftId = String((obj.metadata as Record<string, unknown> | undefined)?.invoiceDraftId ?? "");
      const draft = draftId ? ctx.store.invoiceDrafts.get(draftId) : null;
      const now = nowIso();
      ctx.store.payments.insert({
        id: newId("pay"),
        createdAt: now,
        updatedAt: now,
        leadId: draft?.leadId ?? "unknown",
        invoiceDraftId: draft?.id ?? null,
        stripeEventId: String(event.id ?? "") || null,
        amountUsd: Number(obj.amount_total ?? 0) / 100,
        status: "succeeded",
        paidAt: now,
      });
      if (draft) {
        ctx.store.writeActivity(draft.leadId, "payment_received", `Payment recorded for ${draft.description}`, {});
      }
    }
    res.json({ ok: true });
  });

  return router;
}

function verifySignature(
  ctx: AppContext,
  provider: "instantly" | "stripe",
  rawBody: string,
  signature: string | undefined,
  secret: string | undefined,
): { accept: boolean; signatureValid: boolean | null } {
  if (secret) {
    const valid = hmacSignatureValid(rawBody, signature, secret);
    if (!valid) {
      ctx.store.writeCompliance("webhook_signature_invalid", `${provider} webhook rejected: bad/missing signature`, {});
    }
    return { accept: valid, signatureValid: valid };
  }
  // No secret configured: acceptable only in local dry-run, and loudly recorded.
  if (ctx.config.env === "local" && ctx.config.dryRun) {
    ctx.store.writeCompliance(
      "webhook_unsigned_accepted_dry_run",
      `${provider} webhook accepted WITHOUT signature (local dry-run only)`,
      {},
    );
    return { accept: true, signatureValid: null };
  }
  ctx.store.writeCompliance("webhook_signature_invalid", `${provider} webhook rejected: no secret configured`, {});
  return { accept: false, signatureValid: false };
}

function recordWebhook(ctx: AppContext, provider: "instantly" | "stripe", eventType: string, payload: string, signatureValid: boolean | null): void {
  const now = nowIso();
  ctx.store.webhookEvents.insert({
    id: newId("whk"),
    createdAt: now,
    updatedAt: now,
    provider,
    eventType,
    signatureValid,
    payload: payload.slice(0, 10_000),
    processed: true,
    processingError: null,
  });
}
