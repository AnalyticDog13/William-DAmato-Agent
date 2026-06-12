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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const williamEnv = (env.WILLIAM_ENV ?? "local") as WilliamEnv;
  if (!["local", "staging", "production"].includes(williamEnv)) {
    throw new Error(`Invalid WILLIAM_ENV: ${williamEnv}`);
  }
  // SAFETY: local can never run live side effects, regardless of DRY_RUN.
  const dryRun = williamEnv === "local" ? true : env.DRY_RUN !== "false";
  const auditorMode = (env.AUDITOR_MODE ?? "mock") as RuntimeConfig["auditorMode"];
  return {
    env: williamEnv,
    dryRun,
    dataDir: env.DATA_DIR ?? "./data",
    apiPort: Number(env.API_PORT ?? 4000),
    apiBaseUrl: env.API_BASE_URL ?? "http://localhost:4000",
    dashboardOrigin: env.DASHBOARD_ORIGIN ?? "http://localhost:5173",
    ownerApiToken: env.OWNER_API_TOKEN || undefined,
    auditorMode: ["mock", "http", "playwright"].includes(auditorMode) ? auditorMode : "mock",
  };
}
