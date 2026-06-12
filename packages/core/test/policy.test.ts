import { describe, expect, it } from "vitest";
import {
  PolicyEngine,
  type PolicyEvaluationInput,
  type ApprovalRequest,
  type GatePolicy,
  nowIso,
} from "../src/index";

const audits: unknown[] = [];
const engine = new PolicyEngine((e) => audits.push(e));

function baseInput(overrides: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  return {
    gate: "SEND_FIRST_TOUCH",
    subjectType: "OutreachDraft",
    subjectId: "draft_1",
    traceId: "trc_test",
    env: "local",
    configDryRun: true,
    ...overrides,
  };
}

function grantedApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  const now = nowIso();
  return {
    id: "apr_1",
    createdAt: now,
    updatedAt: now,
    gate: "SEND_FIRST_TOUCH",
    subjectType: "OutreachDraft",
    subjectId: "draft_1",
    leadId: null,
    title: "t",
    detail: "d",
    requestedBy: "system",
    status: "granted",
    decidedAt: now,
    decidedBy: "owner",
    decisionNote: "",
    expiresAt: null,
    traceId: "trc_test",
    ...overrides,
  };
}

function policy(mode: GatePolicy["mode"], gate: GatePolicy["gate"] = "SEND_FIRST_TOUCH"): GatePolicy {
  return { gate, mode, note: "", updatedAt: nowIso() };
}

describe("authorizeOperational — credential controls live execution (preview deploys)", () => {
  const op = (overrides: Record<string, unknown> = {}) =>
    engine.authorizeOperational({
      action: "vercel.deployPreview",
      subjectType: "SiteProject",
      subjectId: "sp_1",
      traceId: "trc_test",
      env: "staging",
      configDryRun: false,
      credential: null,
      ...overrides,
    });

  it("stays dry-run without a credential; sandbox credential goes live in staging only", () => {
    expect(op().dryRun).toBe(true); // no credential → simulate
    expect(op({ credential: { mode: "sandbox" } }).dryRun).toBe(false);
    expect(op({ env: "local", credential: { mode: "sandbox" } }).dryRun).toBe(true); // local always dry-run
    expect(op({ env: "production", credential: { mode: "sandbox" } }).dryRun).toBe(true); // prod needs live
    expect(op({ env: "production", credential: { mode: "live" } }).dryRun).toBe(false);
  });
});

describe("PolicyEngine — dangerous actions are blocked without approval", () => {
  it("denies when no approval exists (default approval mode)", () => {
    const d = engine.evaluate(baseInput());
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("denied_approval_required");
    expect(d.ticket).toBeUndefined();
  });

  it("denies for every named gate without approval", () => {
    const gates = [
      "SEND_FIRST_TOUCH",
      "ACTIVATE_NEW_LEAD_SOURCE",
      "ENABLE_SOCIAL_SOURCE",
      "SEND_PAYMENT_REQUEST",
      "DEPLOY_PRODUCTION",
      "UPDATE_LIVE_COPY",
      "CHANGE_COMPLIANCE_TEXT",
      "ENABLE_FULL_AUTONOMY",
    ] as const;
    for (const gate of gates) {
      const d = engine.evaluate(baseInput({ gate }));
      expect(d.allowed, gate).toBe(false);
    }
  });

  it("denies rejected, revoked, and expired approvals", () => {
    for (const status of ["rejected", "revoked", "pending", "expired"] as const) {
      const d = engine.evaluate(baseInput({ approval: grantedApproval({ status }) }));
      expect(d.allowed, status).toBe(false);
      expect(d.reasonCode).toBe("denied_approval_invalid");
    }
    const past = new Date(Date.now() - 60_000).toISOString();
    const d = engine.evaluate(baseInput({ approval: grantedApproval({ expiresAt: past }) }));
    expect(d.allowed).toBe(false);
  });

  it("denies approvals for a different subject or gate", () => {
    expect(
      engine.evaluate(baseInput({ approval: grantedApproval({ subjectId: "draft_OTHER" }) })).allowed,
    ).toBe(false);
    expect(
      engine.evaluate(baseInput({ approval: grantedApproval({ gate: "DEPLOY_PRODUCTION" }) })).allowed,
    ).toBe(false);
  });

  it("denies when the gate is closed, even WITH a granted approval", () => {
    const d = engine.evaluate(baseInput({ policy: policy("closed"), approval: grantedApproval() }));
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("denied_gate_closed");
  });
});

describe("PolicyEngine — approved execution", () => {
  it("allows with valid approval but forces dry-run in local env", () => {
    const d = engine.evaluate(baseInput({ approval: grantedApproval() }));
    expect(d.allowed).toBe(true);
    expect(d.effectiveDryRun).toBe(true);
    expect(d.ticket?.dryRun).toBe(true);
  });

  it("forces dry-run when credentials are missing, even in production with DRY_RUN=false", () => {
    const d = engine.evaluate(
      baseInput({
        env: "production",
        configDryRun: false,
        approval: grantedApproval(),
        credential: { mode: "missing" },
      }),
    );
    expect(d.allowed).toBe(true);
    expect(d.effectiveDryRun).toBe(true);
  });

  it("forces dry-run in production when only sandbox credentials exist", () => {
    const d = engine.evaluate(
      baseInput({
        env: "production",
        configDryRun: false,
        approval: grantedApproval(),
        credential: { mode: "sandbox" },
      }),
    );
    expect(d.effectiveDryRun).toBe(true);
  });

  it("allows live execution only with approval + production + live creds + DRY_RUN off", () => {
    const d = engine.evaluate(
      baseInput({
        env: "production",
        configDryRun: false,
        approval: grantedApproval(),
        credential: { mode: "live" },
      }),
    );
    expect(d.allowed).toBe(true);
    expect(d.effectiveDryRun).toBe(false);
    expect(d.ticket?.dryRun).toBe(false);
  });
});

describe("PolicyEngine — autopilot is opt-in and master-gated", () => {
  it("autopilot mode without ENABLE_FULL_AUTONOMY is denied", () => {
    const d = engine.evaluate(
      baseInput({
        env: "production",
        configDryRun: false,
        policy: policy("autopilot"),
        credential: { mode: "live" },
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("denied_autonomy_off");
  });

  it("autopilot works when owner enabled master autonomy in production", () => {
    const d = engine.evaluate(
      baseInput({
        env: "production",
        configDryRun: false,
        policy: policy("autopilot"),
        autonomyPolicy: policy("autopilot", "ENABLE_FULL_AUTONOMY"),
        credential: { mode: "live" },
      }),
    );
    expect(d.allowed).toBe(true);
    expect(d.effectiveDryRun).toBe(false);
  });

  it("autopilot outside production degrades to dry-run", () => {
    const d = engine.evaluate(
      baseInput({
        env: "staging",
        configDryRun: false,
        policy: policy("autopilot"),
        autonomyPolicy: policy("autopilot", "ENABLE_FULL_AUTONOMY"),
        credential: { mode: "sandbox" },
      }),
    );
    expect(d.allowed).toBe(true);
    expect(d.effectiveDryRun).toBe(true);
  });

  it("gates that never allow autopilot still require approval", () => {
    const d = engine.evaluate(
      baseInput({
        gate: "CHANGE_COMPLIANCE_TEXT",
        env: "production",
        configDryRun: false,
        policy: policy("autopilot", "CHANGE_COMPLIANCE_TEXT"),
        autonomyPolicy: policy("autopilot", "ENABLE_FULL_AUTONOMY"),
        credential: { mode: "live" },
      }),
    );
    expect(d.allowed).toBe(false);
  });
});
