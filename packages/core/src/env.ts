export type WilliamEnv = "local" | "staging" | "production";

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
   * Off-switch for William's own website builder. Default false: William is the
   * business head — he generates a WebsiteBrief (build prompt) for the owner and
   * ships the owner's finished repo, but never builds/deploys his own artifact.
   * Flip to true to restore the full self-build pipeline (preview/revise/deploy).
   */
  williamBuildsWebsites: boolean;
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
    williamBuildsWebsites: env.WILLIAM_BUILDS_WEBSITES === "true",
  };
}
