import { describe, expect, it } from "vitest";
import {
  companyIdentityKey,
  identityKeys,
  normalizeDomain,
  normalizeEmail,
} from "../src/index";

describe("normalizeDomain", () => {
  it("strips protocol, www, paths, ports, and case", () => {
    expect(normalizeDomain("HTTPS://WWW.Example.COM/about?x=1")).toBe("example.com");
    expect(normalizeDomain("example.com")).toBe("example.com");
    expect(normalizeDomain("http://example.com:8080/x")).toBe("example.com");
    expect(normalizeDomain("  www.sub.example.com  ")).toBe("sub.example.com");
  });
  it("rejects junk", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Will@Example.COM ")).toBe("will@example.com");
  });
  it("rejects invalid shapes", () => {
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
  });
});

describe("company identity + dedupe keys", () => {
  it("ignores legal suffixes and punctuation", () => {
    expect(companyIdentityKey("Joe's Barbershop, LLC", "Ithaca")).toBe(
      companyIdentityKey("Joes Barbershop", "ithaca"),
    );
  });
  it("differentiates by city", () => {
    expect(companyIdentityKey("Joe's Barbershop", "Ithaca")).not.toBe(
      companyIdentityKey("Joe's Barbershop", "Albany"),
    );
  });
  it("builds identity keys for all known identities", () => {
    expect(
      identityKeys({ domain: "example.com", email: "a@example.com", companyKey: "joes@ithaca" }),
    ).toEqual(["domain:example.com", "email:a@example.com", "company:joes@ithaca"]);
    expect(identityKeys({})).toEqual([]);
  });
});
