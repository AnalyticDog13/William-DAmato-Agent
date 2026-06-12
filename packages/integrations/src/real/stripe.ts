import { createHmac, timingSafeEqual } from "node:crypto";
import type { Logger } from "@william/core";
import type { StripeAdapter } from "../types";
import { callJson, failure, formBody, requireTicket, simulatedReal, type RealDeps } from "./shared";

const API = "https://api.stripe.com/v1";

/**
 * Real Stripe webhook signature scheme: header `t=<unix>,v1=<hmac>` where the
 * HMAC-SHA256 is computed over `${t}.${rawBody}`. Stale timestamps (>5 min)
 * are rejected to block replay.
 */
export function stripeSignatureValid(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!secret || !signatureHeader) return false;
  const parts = new Map<string, string[]>();
  for (const kv of signatureHeader.split(",")) {
    const [k, v] = kv.split("=", 2);
    if (!k || !v) continue;
    parts.set(k.trim(), [...(parts.get(k.trim()) ?? []), v.trim()]);
  }
  const t = Number(parts.get("t")?.[0]);
  const candidates = parts.get("v1") ?? [];
  if (!Number.isFinite(t) || candidates.length === 0) return false;
  if (Math.abs(nowMs / 1000 - t) > 300) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return candidates.some((c) => {
    const given = Buffer.from(c);
    return given.length === want.length && timingSafeEqual(given, want);
  });
}

export function createStripeAdapter(deps: RealDeps, log: Logger): StripeAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const post = (path: string, params: Record<string, string>) =>
    callJson(fetchImpl, `${API}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deps.env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: formBody(params),
    });
  const metaParams = (metadata: Record<string, string> | undefined) =>
    Object.fromEntries(Object.entries(metadata ?? {}).map(([k, v]) => [`metadata[${k}]`, v]));

  return {
    name: "stripe",

    async createPaymentLink(ticket, input) {
      requireTicket(ticket, "stripe.createPaymentLink");
      if (ticket.dryRun) {
        return simulatedReal("stripe", "createPaymentLink", `$${input.amountUsd} — ${input.description}`, "plink");
      }
      const price = await post("/prices", {
        currency: "usd",
        unit_amount: String(Math.round(input.amountUsd * 100)),
        "product_data[name]": input.description,
      });
      if (!price.ok) return failure("stripe.createPaymentLink (price)", price.status, price.text);
      // Payment-link metadata is copied onto Checkout Sessions it creates,
      // which is how the /webhooks/stripe handler matches invoiceDraftId.
      const link = await post("/payment_links", {
        "line_items[0][price]": String(price.body.id),
        "line_items[0][quantity]": "1",
        ...metaParams(input.metadata),
      });
      if (!link.ok) return failure("stripe.createPaymentLink", link.status, link.text);
      log.info("stripe payment link created", { id: link.body.id, traceId: ticket.traceId });
      return {
        dryRun: false,
        ok: true,
        externalId: String(link.body.id),
        url: String(link.body.url),
        detail: `Stripe payment link $${input.amountUsd} — ${input.description}`,
      };
    },

    async createInvoiceDraft(ticket, input) {
      requireTicket(ticket, "stripe.createInvoiceDraft");
      if (ticket.dryRun) {
        return simulatedReal("stripe", "createInvoiceDraft", `${input.customerEmail} $${input.amountUsd}`, "inv");
      }
      const customer = await post("/customers", { email: input.customerEmail });
      if (!customer.ok) return failure("stripe.createInvoiceDraft (customer)", customer.status, customer.text);
      const invoice = await post("/invoices", {
        customer: String(customer.body.id),
        auto_advance: "false",
        collection_method: "send_invoice",
        days_until_due: "14",
        ...metaParams(input.metadata),
      });
      if (!invoice.ok) return failure("stripe.createInvoiceDraft (invoice)", invoice.status, invoice.text);
      const item = await post("/invoiceitems", {
        customer: String(customer.body.id),
        invoice: String(invoice.body.id),
        amount: String(Math.round(input.amountUsd * 100)),
        currency: "usd",
        description: input.description,
      });
      if (!item.ok) return failure("stripe.createInvoiceDraft (item)", item.status, item.text);
      log.info("stripe invoice draft created", { id: invoice.body.id, traceId: ticket.traceId });
      return {
        dryRun: false,
        ok: true,
        externalId: String(invoice.body.id),
        detail: `Stripe DRAFT invoice $${input.amountUsd} for ${input.customerEmail} (not sent — stays draft until finalized)`,
      };
    },

    verifyWebhookSignature: (rawBody, signatureHeader, secret) =>
      stripeSignatureValid(rawBody, signatureHeader, secret),
  };
}
