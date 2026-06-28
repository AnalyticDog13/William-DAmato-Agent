export type WilliamEnv = "local" | "staging" | "production";

/**
 * Load environment variables from a `.env` file (default: `./.env` from the
 * current working directory) into `process.env`, using Node's built-in loader
 * (no dependency). Call ONCE at the very start of each runnable entry point
 * (worker / api / demo / seed) BEFORE `loadConfig`/`createContext` — never inside
 * `loadConfig`, so the test suite stays hermetic. A missing file is a no-op:
 * credentials are optional and the system stays in dry-run with mock adapters
 * until real values exist (Blocked ≠ stuck).
 *
 * No node:fs import keeps this module browser-safe for the dashboard bundle;
 * the function is only ever called from Node entry points.
 */
export function loadDotEnv(path = ".env"): void {
  // process.loadEnvFile throws if the file is missing/unreadable. A MISSING file
  // (ENOENT) is the normal case — credentials are optional; the system stays
  // dry-run with mocks until real values exist (Blocked ≠ stuck). But a file that
  // IS present yet fails to parse/read is worth surfacing, so a typo'd `.env`
  // doesn't silently start with mocks.
  try {
    process.loadEnvFile(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") {
      console.warn(
        `loadDotEnv: ${path} present but could not be loaded:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export interface RuntimeConfig {
  env: WilliamEnv;
  /** Master safety switch. Forced true when env === "local". */
  dryRun: boolean;
  dataDir: string;
  apiPort: number;
  apiBaseUrl: string;
  dashboardOrigin: string;
  ownerApiToken: string | undefined;
  auditorMode: "mock" | "http" | "playwright";
  /** Site-builder output: static single-file preview only, or + React/Framer Motion project. */
  stackMode: "static" | "react";
  /** Minimum Lighthouse scores a generated preview must hit before owner review. */
  previewQuality: { minPerformance: number; minAccessibility: number };
  /**
   * How often (ms) to poll Instantly's /emails API for inbound replies, as a
   * free alternative to the Hypergrowth-gated webhook. 0 disables polling
   * (default). Inert in local (dry-run forces pollInbound to return []).
   */
  instantlyPollIntervalMs: number;
  /** Visual-scoring blend weight (0=ignore visual,1=visual only) + override confidence floors. */
  visualScoring: { weight: number; promoteMinConfidence: number; demoteMinConfidence: number };
  /** Staged email discovery: subpaths the Playwright fallback crawls, capped by
   *  maxPages, a per-page navigation timeout, and an overall wall-clock budget
   *  so a slow site can never blow the per-lead time. */
  emailDiscovery: { subpaths: string[]; maxPages: number; pageTimeoutMs: number; budgetMs: number };
  /** Lead sourcing: Google Places API (v1) search budget and controller re-check interval. */
  leadSourcing: { defaultCandidateCap: number; recheckDelayMs: number };
  /** Only sites scoring ABOVE this (0-100) get an outreach email. Higher score = worse site = better prospect. */
  outreachScoreThreshold: number;
  /** "review" = qualified leads wait for owner Approve & push; "auto" = push to Instantly automatically. */
  pushMode: "review" | "auto";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const williamEnv = (env.WILLIAM_ENV ?? "local") as WilliamEnv;
  if (!["local", "staging", "production"].includes(williamEnv)) {
    throw new Error(`Invalid WILLIAM_ENV: ${williamEnv}`);
  }
  // SAFETY: local can never run live side effects, regardless of DRY_RUN.
  const dryRun = williamEnv === "local" ? true : env.DRY_RUN !== "false";
  const auditorMode = (env.AUDITOR_MODE ?? "mock") as RuntimeConfig["auditorMode"];
  const stackMode = env.STACK_MODE === "react" ? "react" : "static";
  const threshold = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
  };
  const unit = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
  };
  const DEFAULT_SUBPATHS = [
    "/contact", "/contact-us", "/about", "/about-us", "/team",
    "/location", "/locations", "/book", "/booking", "/menu", "/get-in-touch",
  ];
  const subpaths = (env.EMAIL_DISCOVERY_SUBPATHS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const maxPagesRaw = Number(env.EMAIL_DISCOVERY_MAX_PAGES);
  const posInt = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    env: williamEnv,
    dryRun,
    dataDir: env.DATA_DIR ?? "./data",
    apiPort: Number(env.API_PORT ?? 4000),
    apiBaseUrl: env.API_BASE_URL ?? "http://localhost:4000",
    dashboardOrigin: env.DASHBOARD_ORIGIN ?? "http://localhost:5173",
    ownerApiToken: env.OWNER_API_TOKEN || undefined,
    auditorMode: ["mock", "http", "playwright"].includes(auditorMode) ? auditorMode : "mock",
    stackMode,
    previewQuality: {
      minPerformance: threshold(env.PREVIEW_MIN_PERFORMANCE, 70),
      minAccessibility: threshold(env.PREVIEW_MIN_ACCESSIBILITY, 80),
    },
    instantlyPollIntervalMs: (() => {
      const n = Number(env.INSTANTLY_POLL_INTERVAL_MS);
      return Number.isFinite(n) && n > 0 ? n : 0;
    })(),
    visualScoring: {
      weight: unit(env.VISUAL_SCORING_WEIGHT, 0.5),
      promoteMinConfidence: unit(env.VISUAL_PROMOTE_MIN_CONFIDENCE, 0.7),
      demoteMinConfidence: unit(env.VISUAL_DEMOTE_MIN_CONFIDENCE, 0.7),
    },
    emailDiscovery: {
      subpaths: subpaths.length > 0 ? subpaths : DEFAULT_SUBPATHS,
      maxPages: Number.isFinite(maxPagesRaw) && maxPagesRaw > 0 ? Math.floor(maxPagesRaw) : 6,
      pageTimeoutMs: posInt(env.EMAIL_DISCOVERY_PAGE_TIMEOUT_MS, 8_000),
      budgetMs: posInt(env.EMAIL_DISCOVERY_BUDGET_MS, 25_000),
    },
    leadSourcing: {
      defaultCandidateCap: posInt(env.LEAD_SOURCING_CANDIDATE_CAP, 40),
      recheckDelayMs: posInt(env.LEAD_SOURCING_RECHECK_MS, 30_000),
    },
    outreachScoreThreshold: threshold(env.OUTREACH_SCORE_THRESHOLD, 45),
    pushMode: env.PUSH_MODE === "auto" ? "auto" : "review",
  };
}
