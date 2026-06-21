import { describe, expect, it } from "vitest";
import { extractEmails, firstRealEmail, isPlaceholderEmail, PLACEHOLDER_EMAILS, PLACEHOLDER_DOMAINS } from "../src/email";

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
