import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/env";

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
});
