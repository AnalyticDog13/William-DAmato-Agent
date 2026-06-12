import {
  PolicyEngine,
  createLogger,
  loadConfig,
  newId,
  nowIso,
  type Logger,
  type PolicyGateName,
  type PolicyDecision,
  type RuntimeConfig,
} from "@william/core";
import { Store, openDatabase, openMemoryDatabase } from "@william/db";
import { createIntegrations, detectCredentials, type Integrations } from "@william/integrations";
import { MemoryService } from "@william/memory";

export interface AppContext {
  config: RuntimeConfig;
  store: Store;
  log: Logger;
  engine: PolicyEngine;
  integrations: Integrations;
  memory: MemoryService;
}

export function createContext(opts: { inMemory?: boolean; silent?: boolean } = {}): AppContext {
  const config = loadConfig();
  const log = createLogger(
    { app: "william" },
    opts.silent ? () => {} : undefined,
  );
  const store = new Store(opts.inMemory ? openMemoryDatabase() : openDatabase(config.dataDir));
  const engine = new PolicyEngine((entry) => store.writeAudit(entry));
  const integrations = createIntegrations(config, log);
  const memory = new MemoryService(store);
  syncCredentialStatuses(store, config);
  return { config, store, log, engine, integrations, memory };
}

/** Persists current credential detection so the dashboard Integrations page is truthful. */
function syncCredentialStatuses(store: Store, config: RuntimeConfig): void {
  for (const report of detectCredentials(process.env, config.env)) {
    const existing = store.credentialStatuses.findByKey(`integration:${report.integration}`)[0];
    const now = nowIso();
    if (existing) {
      store.credentialStatuses.save({ ...existing, mode: report.mode, lastCheckedAt: now, detail: report.detail });
    } else {
      store.credentialStatuses.insert({
        id: newId("cred"),
        createdAt: now,
        updatedAt: now,
        integration: report.integration,
        mode: report.mode,
        healthy: report.mode === "missing" ? null : true,
        lastCheckedAt: now,
        detail: report.detail,
      });
    }
  }
}

/** Map from gate to the integration whose credentials gate live execution. */
const GATE_INTEGRATION: Partial<Record<PolicyGateName, string>> = {
  SEND_FIRST_TOUCH: "instantly",
  SEND_PAYMENT_REQUEST: "stripe",
  DEPLOY_PRODUCTION: "vercel",
  UPDATE_LIVE_COPY: "vercel",
  ACTIVATE_NEW_LEAD_SOURCE: "google_maps",
};

/** One-stop policy evaluation that loads policies/approvals/credentials from the store. */
export function evaluateGate(
  ctx: AppContext,
  input: {
    gate: PolicyGateName;
    subjectType: string;
    subjectId: string;
    leadId?: string | null;
    traceId: string;
  },
): PolicyDecision {
  const approval =
    ctx.store.approvals
      .findByKey(`subject:${input.gate}:${input.subjectId}`)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const integration = GATE_INTEGRATION[input.gate];
  const credential = integration
    ? (ctx.store.credentialStatuses.findByKey(`integration:${integration}`)[0] ?? null)
    : null;
  return ctx.engine.evaluate({
    gate: input.gate,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    leadId: input.leadId ?? null,
    traceId: input.traceId,
    env: ctx.config.env,
    configDryRun: ctx.config.dryRun,
    policy: ctx.store.getGatePolicy(input.gate),
    autonomyPolicy: ctx.store.getGatePolicy("ENABLE_FULL_AUTONOMY"),
    approval,
    credential: credential ? { mode: credential.mode } : { mode: "missing" },
  });
}

/** Operational (ungated) ticket for read-only/preview external calls. */
export function operationalTicket(
  ctx: AppContext,
  action: string,
  subject: { type: string; id: string; leadId?: string | null },
  traceId: string,
) {
  return ctx.engine.authorizeOperational({
    action,
    subjectType: subject.type,
    subjectId: subject.id,
    leadId: subject.leadId ?? null,
    traceId,
    env: ctx.config.env,
    configDryRun: ctx.config.dryRun,
    credential: null,
  });
}
