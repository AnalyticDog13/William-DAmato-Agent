import { describe, expect, it } from "vitest";
import { bestBusinessEmail, extractEmails, firstRealEmail, isPlaceholderEmail, isTopTierContact, PLACEHOLDER_EMAILS, PLACEHOLDER_DOMAINS } from "../src/email";

describe("email helpers", () => {
  it("flags the owner's placeholder addresses and domains", () => {
    for (const e of [
      "info@example.com", "contact@info.com", "info@contact.com",
      "hello@contact.com", "hello@example.com", "anyone@yourdomain.com",
    ]) expect(isPlaceholderEmail(e)).toBe(true);
    expect(isPlaceholderEmail("owner@joesbarber.com")).toBe(false);
  });

  it("KEEPS common contact prefixes on a real business domain (info@/contact@/team@ are valid)", () => {
    for (const e of [
      "info@corner-roasters.co", "contact@joesbarber.com", "team@acmeplumbing.io",
      "hello@realsalon.co", "sales@shop.store", "bookings@spa.dev",
    ]) expect(isPlaceholderEmail(e)).toBe(false);
  });

  it("REJECTS addresses on placeholder/template domains regardless of prefix", () => {
    for (const e of [
      "info@example.com", "owner@info.com", "anything@contact.com",
      "x@test.com", "y@your-domain.com", "z@mysite.com",
    ]) expect(isPlaceholderEmail(e)).toBe(true);
  });

  it("REJECTS theme/store-builder placeholder domains (mystore.com & friends)", () => {
    for (const e of [
      "info@mystore.com", "owner@yourstore.com", "hello@yourcompany.com",
      "sales@yourbusiness.com", "x@demo.com", "y@acme.com", "z@mailinator.com",
      "team@companyname.com", "hi@placeholder.com",
      "noreply@sentry-next.wixpress.com", // Wix/Sentry telemetry leak
    ]) expect(isPlaceholderEmail(e)).toBe(true);
    // A real custom domain or real provider is still kept.
    expect(isPlaceholderEmail("hola@localcafe.co")).toBe(false);
    expect(isPlaceholderEmail("owner@gmail.com")).toBe(false);
  });

  it("regression: a leftover @mystore.com no longer shadows the real address", () => {
    // Mirrors a real-lead bug — a Shopify-template info@mystore.com appeared
    // before the real email and was wrongly approved. It must now be skipped so
    // the real address wins.
    expect(firstRealEmail(["info@mystore.com", "hola@localcafe.co"])).toBe("hola@localcafe.co");
    expect(firstRealEmail(["info@mystore.com"])).toBeNull();
  });

  it("extracts, lowercases, dedupes, and drops asset-shaped matches", () => {
    const text = "Email US: Owner@JoesBarber.com or owner@joesbarber.com. logo@2x.png sprite@3x.jpg icon@1x.svg style@1x.css";
    expect(extractEmails(text)).toEqual(["owner@joesbarber.com"]);
  });

  it("exports the placeholder sets", () => {
    expect(PLACEHOLDER_EMAILS.has("info@example.com")).toBe(true);
    expect(PLACEHOLDER_DOMAINS.has("example.com")).toBe(true);
  });

  it("firstRealEmail skips placeholders and returns the first real address", () => {
    expect(firstRealEmail(["info@example.com", "owner@joesbarber.com"])).toBe("owner@joesbarber.com");
    expect(firstRealEmail(["info@example.com"])).toBeNull();
    expect(firstRealEmail([])).toBeNull();
  });
});

describe("isPlaceholderEmail — telemetry subdomain (suffix) matching", () => {
  it("rejects ANY subdomain of a telemetry-noise domain (wixpress.com / sentry.io)", () => {
    for (const e of [
      "x@sentry.wixpress.com", // the reported leak
      "x@sentry-next.wixpress.com", // prior leak, still caught via wixpress.com
      "x@foo.bar.wixpress.com",
      "o123@o45.ingest.sentry.io", // Sentry telemetry subdomain
      "x@wixpress.com", // the apex itself still matches
      "x@sentry.io", // apex of a suffix domain also matches
    ]) expect(isPlaceholderEmail(e), e).toBe(true);
  });

  it("does NOT suffix-match the exact template domains — *.example.com stays usable as a fixture", () => {
    // example.com is exact-only (the suite uses *.example.com as real-business
    // stand-ins); only the bare domain is a placeholder, not its subdomains.
    expect(isPlaceholderEmail("info@example.com")).toBe(true);
    expect(isPlaceholderEmail("info@apitest.example.com")).toBe(false);
    expect(isPlaceholderEmail("info@a-coffee.example.com")).toBe(false);
  });

  it("does NOT over-match a real domain that merely ends with placeholder text (label boundary)", () => {
    // myemail.com must NOT match the placeholder email.com.
    expect(isPlaceholderEmail("info@myemail.com")).toBe(false);
    expect(isPlaceholderEmail("info@notexample.com")).toBe(false);
    expect(isPlaceholderEmail("info@easlandscaping.com")).toBe(false);
  });
});

describe("bestBusinessEmail — ranked picker", () => {
  const site = "https://easlandscaping.com";

  it("prefers a role address on the company's own domain over off-domain junk", () => {
    expect(
      bestBusinessEmail(["analytics@3rdpartywidget.io", "noreply@vendor.com", "info@easlandscaping.com"], { siteUrl: site }),
    ).toBe("info@easlandscaping.com");
  });

  it("regression: raw-HTML junk (incl. sentry.wixpress.com) never beats the real service email", () => {
    expect(
      bestBusinessEmail(["wix@sentry.wixpress.com", "track@segment.io", "info@easlandscaping.com"], { siteUrl: site }),
    ).toBe("info@easlandscaping.com");
  });

  it("prefers any company-domain address over an off-domain role address", () => {
    expect(bestBusinessEmail(["info@partner.com", "john@easlandscaping.com"], { siteUrl: site })).toBe("john@easlandscaping.com");
  });

  it("prefers a company-named free-provider address over a random off-domain one", () => {
    expect(
      bestBusinessEmail(["accounts@randomcorp.com", "easlandscaping@gmail.com"], { siteUrl: site, companyName: "EAS Landscaping" }),
    ).toBe("easlandscaping@gmail.com");
  });

  it("treats a short prefix abbreviation as the company address (eas@ for EAS Landscaping)", () => {
    expect(bestBusinessEmail(["random@othercorp.com", "eas@gmail.com"], { siteUrl: site })).toBe("eas@gmail.com");
  });

  it("does NOT promote a free address whose local is a non-prefix substring of the company name", () => {
    // "scaping" is inside "easlandscaping" but not a prefix → not company-named, so a
    // real role address on another domain (40) still outranks the gmail (20).
    expect(bestBusinessEmail(["scaping@gmail.com", "info@otherbiz.com"], { siteUrl: site })).toBe("info@otherbiz.com");
  });

  it("a role on the own domain beats the company gmail", () => {
    expect(bestBusinessEmail(["easlandscaping@gmail.com", "info@easlandscaping.com"], { siteUrl: site })).toBe("info@easlandscaping.com");
  });

  it("demotes no-reply/system addresses below a real role on the same domain", () => {
    expect(bestBusinessEmail(["noreply@easlandscaping.com", "contact@easlandscaping.com"], { siteUrl: site })).toBe("contact@easlandscaping.com");
  });

  it("excludes placeholders entirely", () => {
    expect(bestBusinessEmail(["info@example.com"], { siteUrl: site })).toBeNull();
    expect(bestBusinessEmail(["info@example.com", "info@easlandscaping.com"], { siteUrl: site })).toBe("info@easlandscaping.com");
  });

  it("lenient fallback: returns the best available when no company match exists", () => {
    expect(bestBusinessEmail(["jane@somebiz.com"], { siteUrl: site })).toBe("jane@somebiz.com");
  });

  it("returns null for no candidates", () => {
    expect(bestBusinessEmail([], { siteUrl: site })).toBeNull();
  });

  it("works without context (no siteUrl): still demotes junk, keeps a real address", () => {
    expect(bestBusinessEmail(["noreply@foo.com", "jane@foo.com"])).toBe("jane@foo.com");
  });
});

describe("isTopTierContact — role address on the company's own domain", () => {
  const site = "https://easlandscaping.com";
  it("is true only for a role local-part on the own domain", () => {
    expect(isTopTierContact("info@easlandscaping.com", { siteUrl: site })).toBe(true);
    expect(isTopTierContact("contact@mail.easlandscaping.com", { siteUrl: site })).toBe(true);
    expect(isTopTierContact("john@easlandscaping.com", { siteUrl: site })).toBe(false); // not a role
    expect(isTopTierContact("info@partner.com", { siteUrl: site })).toBe(false); // off domain
    expect(isTopTierContact("info@easlandscaping.com")).toBe(false); // no site context
  });
});
