import {
  newId,
  nowIso,
  type InvoiceDraft,
  type Lead,
  type PolicyTicket,
} from "@william/core";
import type { StripeAdapter } from "@william/integrations";

export interface BillingDraftInput {
  lead: Lead;
  opportunityId?: string | null;
  kind: "payment_link" | "invoice";
  description: string;
  amountUsd: number;
}

/**
 * Creates a LOCAL invoice draft record. No Stripe call happens here — pushing
 * the draft to Stripe and sending it are separate, SEND_PAYMENT_REQUEST-gated
 * steps. Drafts are always safe to create.
 */
export function createInvoiceDraft(input: BillingDraftInput): InvoiceDraft {
  const now = nowIso();
  return {
    id: newId("invd"),
    createdAt: now,
    updatedAt: now,
    leadId: input.lead.id,
    opportunityId: input.opportunityId ?? null,
    kind: input.kind,
    description: input.description,
    amountUsd: input.amountUsd,
    stripeObjectId: null,
    url: null,
    status: "draft",
    approvalRequestId: null,
  };
}

/**
 * Executes an APPROVED draft against Stripe (or simulates under dry-run).
 * Requires a SEND_PAYMENT_REQUEST PolicyTicket — unobtainable without owner
 * approval or explicitly-enabled autopilot.
 */
export async function executeInvoiceDraft(
  draft: InvoiceDraft,
  customerEmail: string,
  stripe: StripeAdapter,
  ticket: PolicyTicket,
): Promise<InvoiceDraft> {
  const result =
    draft.kind === "payment_link"
      ? await stripe.createPaymentLink(ticket, {
          description: draft.description,
          amountUsd: draft.amountUsd,
          metadata: { invoiceDraftId: draft.id },
        })
      : await stripe.createInvoiceDraft(ticket, {
          customerEmail,
          description: draft.description,
          amountUsd: draft.amountUsd,
          metadata: { invoiceDraftId: draft.id },
        });
  return {
    ...draft,
    updatedAt: nowIso(),
    stripeObjectId: result.externalId ?? null,
    url: result.url ?? null,
    status: result.ok ? (result.dryRun ? "sent_dry_run" : "sent") : draft.status,
  };
}
