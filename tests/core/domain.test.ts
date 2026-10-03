import { describe, expect, it } from "vitest";
import { isSubdomainRelated, normaliseDomain } from "@/core/identity/domain";

describe("normaliseDomain", () => {
  it.each([
    ["acme.co.za", "acme.co.za"],
    ["ACME.CO.ZA", "acme.co.za"],
    ["  acme.co.za  ", "acme.co.za"],
    ["www.acme.co.za", "acme.co.za"],
    ["WWW.Acme.co.za", "acme.co.za"],
    ["http://acme.co.za", "acme.co.za"],
    ["https://www.acme.co.za/", "acme.co.za"],
    ["https://www.acme.co.za/contact-us?ref=x#top", "acme.co.za"],
    ["acme.co.za/products/pumps", "acme.co.za"],
    ["https://acme.co.za:8443/", "acme.co.za"],
    ["https://user:pass@acme.co.za", "acme.co.za"],
    ["acme.co.za.", "acme.co.za"],
    ["shop.acme.co.za", "shop.acme.co.za"],
    ["www2.acme.co.za", "www2.acme.co.za"],
    ["my-business.com", "my-business.com"],
    ["bücher.co.za", "xn--bcher-kva.co.za"],
    ["acme.wixsite.com/home", "acme.wixsite.com"],
    ["123acme.africa", "123acme.africa"],
  ])("%s → %s", (input, expected) => {
    expect(normaliseDomain(input)).toEqual({ ok: true, domain: expected });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["info@acme.co.za", "email_address"],
    ["acme co za", "unparseable"],
    ["ftp://acme.co.za", "unparseable"],
    ["mailto:info@acme.co.za", "email_address"],
    ["http://", "unparseable"],
    ["192.168.1.10", "ip_address"],
    ["http://[::1]/", "ip_address"],
    ["acme", "no_public_suffix"],
    ["localhost", "no_public_suffix"],
    ["-acme.co.za", "invalid_label"],
    ["acme-.co.za", "invalid_label"],
    ["acme..co.za", "invalid_label"],
    ["acme.123", "unparseable"],
    [`${"a".repeat(64)}.co.za`, "invalid_label"],
    [`${"abc.".repeat(64)}co.za`, "too_long"],
    ["https://www.facebook.com/acmesupplies", "shared_platform_host"],
    ["instagram.com/acme", "shared_platform_host"],
    ["https://linktr.ee/acme", "shared_platform_host"],
    ["https://wa.me/27411234567", "shared_platform_host"],
    ["sites.google.com/view/acme", "shared_platform_host"],
  ])("%j is rejected as %s", (input, issue) => {
    const r = normaliseDomain(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue).toBe(issue);
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it("is idempotent", () => {
    for (const input of ["https://WWW.Acme.co.za/x", "shop.acme.co.za", "bücher.co.za"]) {
      const once = normaliseDomain(input);
      if (!once.ok) throw new Error("expected ok");
      expect(normaliseDomain(once.domain)).toEqual(once);
    }
  });
});

describe("isSubdomainRelated", () => {
  it.each([
    ["shop.acme.co.za", "acme.co.za", true],
    ["acme.co.za", "shop.acme.co.za", true],
    ["acme.co.za", "acme.co.za", false],
    ["notacme.co.za", "acme.co.za", false],
    ["acme.co.za", "acme.com", false],
  ])("%s ~ %s = %s", (a, b, expected) => {
    expect(isSubdomainRelated(a, b)).toBe(expected);
  });
});
