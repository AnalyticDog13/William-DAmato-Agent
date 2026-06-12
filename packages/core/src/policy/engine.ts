import { newId, nowIso } from "../ids";
import type { WilliamEnv } from "../env";
import type { ApprovalRequest, GatePolicy, PolicyGateName } from "../schema/approval";
import type { AuditLogEntry } from "../schema/infra";
import { GATE_DEFINITIONS } from "./gates";

/**
 * A PolicyTicket is the ONLY way to invoke a side-effecting adapter method.
 * Tickets are issued exclusively by PolicyEngine.evaluate — there is no other
 * constructor — so any code path reaching an external side effect has, by
 * construction, passed the policy engine.
 */
export interface PolicyTicket {
  readonly __policyTicket: true;
  readonly gate: PolicyGateName;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly traceId: string;
  /** If true the adapter MUST simulate; never perform the live action. */
  readonly dryRun: boolean;
  readonly issuedAt: string;
  readonly nonce: string;
}

export interface CredentialInfo {
  mode: "missing" | "sandbox" | "live";
}

export interface PolicyEvaluationInput {
  gate: PolicyGateName;
  subjectType: string;
  subjectId: string;
  leadId?: string | null;
  traceId: string;
  env: WilliamEnv;
  /** Master DRY_RUN from runtime config. */
  configDryRun: boolean;
  /** Current owner-configured policy for this gate (defaults applied if absent). */
  policy?: GatePolicy | null;
  /** Owner-configured master-autonomy policy (gate ENABLE_FULL_AUTONOMY). */
  autonomyPolicy?: GatePolicy | null;
  /** A candidate approval for this exact subject, if one exists. */
  approval?: ApprovalRequest | null;
  /** Credential status for the adapter that would execute. */
  credential?: CredentialInfo | null;
}

export interface PolicyDecision {
  allowed: boolean;
  /** When allowed, whether execution must be simulated. */
  effectiveDryRun: boolean;
  reason: string;
  reasonCode:
    | "ok_approved"
    | "ok_autopilot"
    | "denied_gate_closed"
    | "denied_approval_required"
    | "denied_approval_invalid"
    | "denied_autonomy_off"
    | "denied_env";
  ticket?: PolicyTicket;
}

export type AuditSink = (entry: Omit<AuditLogEntry, "id" | "createdAt" | "updatedAt">) => void;

export function approvalIsValid(
  approval: ApprovalRequest | null | undefined,
  gate: PolicyGateName,
  subjectId: string,
  now: Date = new Date(),
): boolean {
  if (!approval) return false;
  if (approval.gate !== gate) return false;
  if (approval.subjectId !== subjectId) return false;
  if (approval.status !== "granted") return false;
  if (approval.expiresAt && new Date(approval.expiresAt).getTime() < now.getTime()) return false;
  return true;
}

export class PolicyEngine {
  constructor(private readonly auditSink: AuditSink) {}

  evaluate(input: PolicyEvaluationInput): PolicyDecision {
    const def = GATE_DEFINITIONS[input.gate];
    const mode = input.policy?.mode ?? "approval";
    const decision = this.decide(input, mode, def.allowAutopilot);

    this.auditSink({
      traceId: input.traceId,
      actor: "system",
      action: `policy.evaluate:${input.gate}`,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      leadId: input.leadId ?? null,
      gate: input.gate,
      outcome: decision.allowed ? (decision.effectiveDryRun ? "dry_run" : "allowed") : "denied",
      detail: `${decision.reasonCode}: ${decision.reason}`,
    });
    return decision;
  }

  private decide(
    input: PolicyEvaluationInput,
    mode: "closed" | "approval" | "autopilot",
    allowAutopilot: boolean,
  ): PolicyDecision {
    if (mode === "closed") {
      return {
        allowed: false,
        effectiveDryRun: true,
        reasonCode: "denied_gate_closed",
        reason: `Gate ${input.gate} is closed by owner policy.`,
      };
    }

    const hasValidApproval = approvalIsValid(input.approval, input.gate, input.subjectId);

    if (!hasValidApproval && mode === "autopilot") {
      const autonomyOn = input.autonomyPolicy?.mode === "autopilot";
      if (!allowAutopilot || !autonomyOn) {
        return {
          allowed: false,
          effectiveDryRun: true,
          reasonCode: "denied_autonomy_off",
          reason: !allowAutopilot
            ? `Gate ${input.gate} never permits autopilot; per-action approval required.`
            : "ENABLE_FULL_AUTONOMY is not enabled by owner; per-action approval required.",
        };
      }
      if (input.env !== "production") {
        // Autopilot below production still allowed, but only as dry-run simulation.
        return this.allow(input, true, "ok_autopilot", "Autopilot outside production runs as dry-run.");
      }
      return this.allow(input, this.computeDryRun(input), "ok_autopilot", "Autopilot pre-authorized by owner.");
    }

    if (!hasValidApproval) {
      const why = input.approval
        ? `Approval ${input.approval.id} is not valid for this action (status=${input.approval.status}).`
        : "No approval exists for this action.";
      return {
        allowed: false,
        effectiveDryRun: true,
        reasonCode: input.approval ? "denied_approval_invalid" : "denied_approval_required",
        reason: why,
      };
    }

    return this.allow(input, this.computeDryRun(input), "ok_approved", "Owner approval granted.");
  }

  /** Live execution requires: not config dry-run, not local, and adequate credentials. */
  private computeDryRun(input: PolicyEvaluationInput): boolean {
    if (input.configDryRun) return true;
    if (input.env === "local") return true;
    const cred = input.credential?.mode ?? "missing";
    if (cred === "missing") return true;
    if (input.env === "production" && cred !== "live") return true;
    return false;
  }

  private allow(
    input: PolicyEvaluationInput,
    dryRun: boolean,
    reasonCode: PolicyDecision["reasonCode"],
    reason: string,
  ): PolicyDecision {
    const ticket: PolicyTicket = {
      __policyTicket: true,
      gate: input.gate,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      traceId: input.traceId,
      dryRun,
      issuedAt: nowIso(),
      nonce: newId("tkt"),
    };
    return { allowed: true, effectiveDryRun: dryRun, reason, reasonCode, ticket };
  }
}
