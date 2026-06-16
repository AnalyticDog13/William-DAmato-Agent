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

  it("williamBuildsWebsites defaults to false (William is the business head, not the builder)", () => {
    expect(loadConfig({}).williamBuildsWebsites).toBe(false);
  });

  it("WILLIAM_BUILDS_WEBSITES=true re-enables the builder; anything else stays false", () => {
    expect(loadConfig({ WILLIAM_BUILDS_WEBSITES: "true" }).williamBuildsWebsites).toBe(true);
    expect(loadConfig({ WILLIAM_BUILDS_WEBSITES: "false" }).williamBuildsWebsites).toBe(false);
    expect(loadConfig({ WILLIAM_BUILDS_WEBSITES: "1" }).williamBuildsWebsites).toBe(false);
  });

  it("parses INSTANTLY_POLL_INTERVAL_MS (default 0 = disabled, rejects garbage)", () => {
    expect(loadConfig({ WILLIAM_ENV: "local" }).instantlyPollIntervalMs).toBe(0);
    expect(loadConfig({ WILLIAM_ENV: "staging", INSTANTLY_POLL_INTERVAL_MS: "300000" }).instantlyPollIntervalMs).toBe(300000);
    expect(loadConfig({ WILLIAM_ENV: "local", INSTANTLY_POLL_INTERVAL_MS: "-5" }).instantlyPollIntervalMs).toBe(0);
    expect(loadConfig({ WILLIAM_ENV: "local", INSTANTLY_POLL_INTERVAL_MS: "nope" }).instantlyPollIntervalMs).toBe(0);
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
