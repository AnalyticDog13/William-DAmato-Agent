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
import type { ChromiumLauncher } from "@william/worker-site-auditor";

export interface AppContext {
  config: RuntimeConfig;
  store: Store;
  log: Logger;
  engine: PolicyEngine;
  integrations: Integrations;
  memory: MemoryService;
  /** Injectable browser launcher (tests); defaults to real Playwright detection. */
  browserLauncher?: ChromiumLauncher;
}

export function createContext(
  opts: { inMemory?: boolean; silent?: boolean; browserLauncher?: ChromiumLauncher } = {},
): AppContext {
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
  return { config, store, log, engine, integrations, memory, browserLauncher: opts.browserLauncher };
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

/**
 * Operational (ungated) ticket for read-only/preview external calls.
 * Pass a credential only for actions that should execute for real outside
 * local (e.g. owner-triggered preview deploys); without one the engine
 * forces dry-run in every env.
 */
export function operationalTicket(
  ctx: AppContext,
  action: string,
  subject: { type: string; id: string; leadId?: string | null },
  traceId: string,
  credential: { mode: "missing" | "sandbox" | "live" } | null = null,
) {
  return ctx.engine.authorizeOperational({
    action,
    subjectType: subject.type,
    subjectId: subject.id,
    leadId: subject.leadId ?? null,
    traceId,
    env: ctx.config.env,
    configDryRun: ctx.config.dryRun,
    credential,
  });
}

/**
 * Credential param for an operational ticket, resolved by integration name from
 * the credential-status store. Returns null when the credential is
 * absent/missing, so the engine forces dry-run and a provider without a key
 * keeps simulating (invariant 3). Pass the result as `operationalTicket(...)`'s
 * fifth argument for any read/generation adapter call that should run live once
 * env + credentials permit (the LLM, Firecrawl, Instantly, enrichment paths).
 */
export function credentialFor(
  ctx: AppContext,
  integration: string,
): { mode: "sandbox" | "live" } | null {
  const cred = ctx.store.credentialStatuses.findByKey(`integration:${integration}`)[0];
  return cred && cred.mode !== "missing" ? { mode: cred.mode } : null;
}

/**
 * Credential for a local read-only operation that has no external API key — the
 * Playwright email crawl. Authorized to run live in any non-local env; the
 * engine still forces dry-run when env === "local" (invariant 3 keeps local a
 * pure dry-run regardless of this value).
 */
export function localReadCredential(ctx: AppContext): { mode: "sandbox" | "live" } {
  return { mode: ctx.config.env === "production" ? "live" : "sandbox" };
}
