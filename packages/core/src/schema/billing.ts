import { z } from "zod";
import { BaseEntity, Id, IsoDate } from "./common";

export const InvoiceDraft = BaseEntity.extend({
  leadId: Id,
  opportunityId: Id.nullable(),
  kind: z.enum(["payment_link", "invoice"]),
  description: z.string(),
  amountUsd: z.number().positive(),
  stripeObjectId: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  status: z.enum(["draft", "pending_approval", "approved", "sent_dry_run", "sent", "void"]),
  approvalRequestId: Id.nullable().default(null),
});
export type InvoiceDraft = z.infer<typeof InvoiceDraft>;

export const PaymentRecord = BaseEntity.extend({
  leadId: Id,
  invoiceDraftId: Id.nullable(),
  stripeEventId: z.string().nullable(),
  amountUsd: z.number(),
  status: z.enum(["pending", "succeeded", "failed", "refunded"]),
  paidAt: IsoDate.nullable().default(null),
});
export type PaymentRecord = z.infer<typeof PaymentRecord>;
