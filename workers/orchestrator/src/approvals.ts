import { newId, nowIso, type ApprovalRequest, type PolicyGateName } from "@william/core";
import type { AppContext } from "./context";

export interface ApprovalInput {
  gate: PolicyGateName;
  subjectType: string;
  subjectId: string;
  leadId?: string | null;
  title: string;
  detail: string;
  traceId: string;
}

/** Creates a pending approval unless one is already pending/granted for this subject. */
export function requestApproval(ctx: AppContext, input: ApprovalInput): ApprovalRequest {
  const existing = ctx.store.approvals
    .findByKey(`subject:${input.gate}:${input.subjectId}`)
    .find((a) => a.status === "pending" || a.status === "granted");
  if (existing) return existing;

  const now = nowIso();
  const approval: ApprovalRequest = {
    id: newId("apr"),
    createdAt: now,
    updatedAt: now,
    gate: input.gate,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    leadId: input.leadId ?? null,
    title: input.title,
    detail: input.detail,
    requestedBy: "system",
    status: "pending",
    decidedAt: null,
    decidedBy: null,
    decisionNote: "",
    expiresAt: null,
    traceId: input.traceId,
  };
  ctx.store.approvals.insert(approval);
  if (input.leadId) {
    ctx.store.writeActivity(input.leadId, "approval_requested", `${input.gate}: ${input.title}`, {
      traceId: input.traceId,
    });
  }
  return approval;
}

/** Owner decision (called from the API). Granted approvals expire after 7 days. */
export function decideApproval(
  ctx: AppContext,
  approvalId: string,
  decision: "granted" | "rejected",
  note: string,
): ApprovalRequest {
  const approval = ctx.store.approvals.get(approvalId);
  if (!approval) throw new Error(`Approval ${approvalId} not found`);
  if (approval.status !== "pending") throw new Error(`Approval ${approvalId} already ${approval.status}`);
  const now = nowIso();
  const updated: ApprovalRequest = {
    ...approval,
    status: decision,
    decidedAt: now,
    decidedBy: "owner",
    decisionNote: note,
    expiresAt: decision === "granted" ? new Date(Date.now() + 7 * 24 * 3600_000).toISOString() : null,
    updatedAt: now,
  };
  ctx.store.approvals.save(updated);
  ctx.store.writeAudit({
    traceId: approval.traceId,
    actor: "owner",
    action: `approval.${decision}`,
    subjectType: approval.subjectType,
    subjectId: approval.subjectId,
    leadId: approval.leadId,
    gate: approval.gate,
    outcome: "recorded",
    detail: note || `${approval.title}`,
  });
  if (approval.leadId) {
    ctx.store.writeActivity(approval.leadId, `approval_${decision}`, `${approval.gate}: ${approval.title}`, {
      traceId: approval.traceId,
      byApproval: true,
    });
  }
  return updated;
}
