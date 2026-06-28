// workers/site-auditor/test/homepage-email.test.ts
import { describe, expect, it } from "vitest";
import { fetchHomepageEmails } from "../src/homepage-email";

describe("fetchHomepageEmails", () => {
  it("returns [] under dry-run without fetching", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("hi@real.com");
    }) as unknown as typeof fetch;
    const out = await fetchHomepageEmails("https://x.com", { fetchImpl, ticket: { dryRun: true } });
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });

  it("extracts and ranks emails from homepage HTML, dropping placeholders", async () => {
    const html = `<a href="mailto:info@joescoffee.com">email</a> noreply@joescoffee.com you@example.com`;
    const fetchImpl = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
    const out = await fetchHomepageEmails("https://joescoffee.com", {
      fetchImpl,
      ticket: { dryRun: false },
      companyName: "Joe's Coffee",
    });
    expect(out[0]).toBe("info@joescoffee.com");
    expect(out).not.toContain("you@example.com"); // example.com is a placeholder domain
  });

  it("fails closed to [] on HTTP error", async () => {
    const fetchImpl = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    expect(await fetchHomepageEmails("https://x.com", { fetchImpl, ticket: { dryRun: false } })).toEqual([]);
  });

  it("returns [] when response is not ok", async () => {
    const fetchImpl = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    expect(await fetchHomepageEmails("https://x.com", { fetchImpl, ticket: { dryRun: false } })).toEqual([]);
  });

  it("returns [] when no emails found in HTML", async () => {
    const fetchImpl = (async () => new Response("<html><body>no emails here</body></html>", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchHomepageEmails("https://x.com", { fetchImpl, ticket: { dryRun: false } })).toEqual([]);
  });

  it("puts best email first and includes the rest", async () => {
    // noreply gets demoted, info@own-domain is best
    const html = `noreply@acmeplumbing.com info@acmeplumbing.com sales@acmeplumbing.com`;
    const fetchImpl = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
    const out = await fetchHomepageEmails("https://acmeplumbing.com", {
      fetchImpl,
      ticket: { dryRun: false },
      companyName: "Acme Plumbing",
    });
    expect(out[0]).toBe("info@acmeplumbing.com");
    // noreply is a system address but it's on own domain so it should still appear (demoted but not filtered out)
    // the important thing is it's not first
    expect(out.indexOf("info@acmeplumbing.com")).toBeLessThan(out.indexOf("noreply@acmeplumbing.com"));
  });
});
