import { describe, expect, it } from "vitest";
import { extractEmails, firstRealEmail, isPlaceholderEmail } from "../src/email";

describe("email helpers", () => {
  it("flags the owner's placeholder addresses and domains", () => {
    for (const e of [
      "info@example.com", "contact@info.com", "info@contact.com",
      "hello@contact.com", "hello@example.com", "anyone@yourdomain.com",
    ]) expect(isPlaceholderEmail(e)).toBe(true);
    expect(isPlaceholderEmail("owner@joesbarber.com")).toBe(false);
  });

  it("extracts, lowercases, dedupes, and drops asset-shaped matches", () => {
    const text = "Email US: Owner@JoesBarber.com or owner@joesbarber.com. logo@2x.png sprite@3x.jpg";
    expect(extractEmails(text)).toEqual(["owner@joesbarber.com"]);
  });

  it("firstRealEmail skips placeholders and returns the first real address", () => {
    expect(firstRealEmail(["info@example.com", "owner@joesbarber.com"])).toBe("owner@joesbarber.com");
    expect(firstRealEmail(["info@example.com"])).toBeNull();
    expect(firstRealEmail([])).toBeNull();
  });
});
