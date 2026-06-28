import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, loadDotEnv } from "../src/env";

describe("loadConfig flags", () => {
  it("defaults: static stack, 70/80 preview thresholds, local forces dry-run", () => {
    const config = loadConfig({});
    expect(config.stackMode).toBe("static");
    expect(config.previewQuality).toEqual({ minPerformance: 70, minAccessibility: 80 });
    expect(config.dryRun).toBe(true);
  });

  it("STACK_MODE=react selects react builds; anything else stays static", () => {
    expect(loadConfig({ STACK_MODE: "react" }).stackMode).toBe("react");
    expect(loadConfig({ STACK_MODE: "vue" }).stackMode).toBe("static");
  });

  it("preview thresholds come from env and reject garbage", () => {
    const config = loadConfig({ PREVIEW_MIN_PERFORMANCE: "55", PREVIEW_MIN_ACCESSIBILITY: "95" });
    expect(config.previewQuality).toEqual({ minPerformance: 55, minAccessibility: 95 });
    const bad = loadConfig({ PREVIEW_MIN_PERFORMANCE: "fast", PREVIEW_MIN_ACCESSIBILITY: "-5" });
    expect(bad.previewQuality).toEqual({ minPerformance: 70, minAccessibility: 80 });
  });

  it("local env can never disable dry-run, even with DRY_RUN=false", () => {
    expect(loadConfig({ WILLIAM_ENV: "local", DRY_RUN: "false" }).dryRun).toBe(true);
  });

  it("parses INSTANTLY_POLL_INTERVAL_MS (default 0 = disabled, rejects garbage)", () => {
    expect(loadConfig({ WILLIAM_ENV: "local" }).instantlyPollIntervalMs).toBe(0);
    expect(loadConfig({ WILLIAM_ENV: "staging", INSTANTLY_POLL_INTERVAL_MS: "300000" }).instantlyPollIntervalMs).toBe(300000);
    expect(loadConfig({ WILLIAM_ENV: "local", INSTANTLY_POLL_INTERVAL_MS: "-5" }).instantlyPollIntervalMs).toBe(0);
    expect(loadConfig({ WILLIAM_ENV: "local", INSTANTLY_POLL_INTERVAL_MS: "nope" }).instantlyPollIntervalMs).toBe(0);
  });

  it("defaults visualScoring and emailDiscovery", () => {
    const cfg = loadConfig({ WILLIAM_ENV: "local" } as NodeJS.ProcessEnv);
    expect(cfg.visualScoring).toEqual({ weight: 0.5, promoteMinConfidence: 0.7, demoteMinConfidence: 0.7 });
    expect(cfg.emailDiscovery.maxPages).toBe(6);
    expect(cfg.emailDiscovery.subpaths).toContain("/contact");
    expect(cfg.emailDiscovery.pageTimeoutMs).toBe(8_000);
    expect(cfg.emailDiscovery.budgetMs).toBe(25_000);
  });

  it("parses + clamps visualScoring and parses subpaths", () => {
    const cfg = loadConfig({
      WILLIAM_ENV: "staging", DRY_RUN: "true",
      VISUAL_SCORING_WEIGHT: "0.3", VISUAL_PROMOTE_MIN_CONFIDENCE: "9", // out of range → default
      EMAIL_DISCOVERY_SUBPATHS: "/a, /b ,/c", EMAIL_DISCOVERY_MAX_PAGES: "3",
    } as NodeJS.ProcessEnv);
    expect(cfg.visualScoring.weight).toBe(0.3);
    expect(cfg.visualScoring.promoteMinConfidence).toBe(0.7); // clamped back to default
    expect(cfg.emailDiscovery.subpaths).toEqual(["/a", "/b", "/c"]);
    expect(cfg.emailDiscovery.maxPages).toBe(3);
  });

  it("exposes leadSourcing defaults", () => {
    const cfg = loadConfig();
    expect(cfg.leadSourcing.defaultCandidateCap).toBe(40);
    expect(cfg.leadSourcing.recheckDelayMs).toBeGreaterThan(0);
  });

  it("defaults outreachScoreThreshold to 45 and pushMode to review", () => {
    const c = loadConfig({ WILLIAM_ENV: "local" } as NodeJS.ProcessEnv);
    expect(c.outreachScoreThreshold).toBe(45);
    expect(c.pushMode).toBe("review");
  });

  it("reads OUTREACH_SCORE_THRESHOLD and PUSH_MODE from env", () => {
    const c = loadConfig({ WILLIAM_ENV: "staging", OUTREACH_SCORE_THRESHOLD: "60", PUSH_MODE: "auto" } as NodeJS.ProcessEnv);
    expect(c.outreachScoreThreshold).toBe(60);
    expect(c.pushMode).toBe("auto");
  });

  it("ignores an out-of-range or invalid threshold/push mode", () => {
    const c = loadConfig({ WILLIAM_ENV: "staging", OUTREACH_SCORE_THRESHOLD: "999", PUSH_MODE: "banana" } as NodeJS.ProcessEnv);
    expect(c.outreachScoreThreshold).toBe(45);
    expect(c.pushMode).toBe("review");
  });
});

describe("loadDotEnv", () => {
  it("loads variables from a .env file into process.env", () => {
    const file = join(tmpdir(), `william-dotenv-${Date.now()}.env`);
    writeFileSync(file, "WILLIAM_DOTENV_PROBE=loaded-from-file\n");
    try {
      delete process.env.WILLIAM_DOTENV_PROBE;
      loadDotEnv(file);
      expect(process.env.WILLIAM_DOTENV_PROBE).toBe("loaded-from-file");
    } finally {
      delete process.env.WILLIAM_DOTENV_PROBE;
      rmSync(file, { force: true });
    }
  });

  it("is a no-op (no throw) when the file does not exist", () => {
    expect(() => loadDotEnv(join(tmpdir(), "william-nonexistent-xyz.env"))).not.toThrow();
  });
});
