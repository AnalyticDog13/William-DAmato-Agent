import { createServer } from "node:net";
import type { Logger } from "@william/core";

/**
 * Structural subset of Playwright's Page/Browser used by the auditor.
 * Lets tests inject fakes and keeps `playwright` a runtime-optional import.
 */
export interface MinimalPage {
  url(): string;
  goto(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number }): Promise<unknown>;
  /** Optional in the structural type so injected fakes need not implement it;
   * real Playwright provides both. Used to let lazy/async imagery settle. */
  waitForLoadState?(state: "load" | "domcontentloaded" | "networkidle", opts?: { timeout?: number }): Promise<unknown>;
  waitForTimeout?(ms: number): Promise<unknown>;
  title(): Promise<string>;
  content(): Promise<string>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<unknown>;
  addScriptTag(opts: { content: string }): Promise<unknown>;
  evaluate<T>(fn: () => unknown): Promise<T>;
  close(): Promise<void>;
}

export interface MinimalBrowser {
  newPage(opts?: { viewport?: { width: number; height: number } }): Promise<MinimalPage>;
  close(): Promise<void>;
}

export type ChromiumLauncher = (log: Logger, opts?: { args?: string[] }) => Promise<MinimalBrowser | null>;

/**
 * Launches headless Chromium via Playwright. Returns null (never throws) when
 * the package or browser binaries are missing — callers fall back to http mode.
 * Real runs need `npx playwright install chromium`.
 */
export const launchChromium: ChromiumLauncher = async (log, opts) => {
  try {
    const { chromium } = await import("playwright");
    return (await chromium.launch({ headless: true, args: opts?.args })) as unknown as MinimalBrowser;
  } catch (err) {
    log.warn("Playwright/Chromium unavailable — browser-grade audit disabled", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};

/** Finds a free localhost port (for Chromium's CDP endpoint / preview server). */
export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}
