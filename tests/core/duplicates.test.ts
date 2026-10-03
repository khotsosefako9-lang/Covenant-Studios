import { describe, expect, it } from "vitest";
import { type IdentityProfile, findDuplicateCandidates } from "@/core/identity/duplicates";

const p = (id: string, over: Partial<IdentityProfile> = {}): IdentityProfile => ({
  id,
  domain: null,
  normalisedName: id,
  phones: [],
  emails: [],
  ...over,
});

describe("findDuplicateCandidates", () => {
  it("proposes exact and near name matches with ordered ids", () => {
    const out = findDuplicateCandidates(p("b", { normalisedName: "acme supplies" }), [
      p("a", { normalisedName: "acme supplies" }),
      p("c", { normalisedName: "acme suplies" }),
      p("d", { normalisedName: "zulu catering" }),
    ], 0.6);
    expect(out).toEqual([
      { companyAId: "a", companyBId: "b", matchBasis: "normalised_name", matchedValue: "acme supplies", similarity: 1 },
      { companyAId: "b", companyBId: "c", matchBasis: "normalised_name", matchedValue: "acme supplies ~ acme suplies", similarity: 0.8 },
    ]);
  });

  it("keeps Covenant Kreative and Covenant Digital Marketing apart at the default threshold", () => {
    expect(findDuplicateCandidates(p("a", { normalisedName: "covenant kreative" }), [p("b", { normalisedName: "covenant digital marketing" })], 0.6)).toEqual([]);
  });

  it("proposes subdomain, phone and email matches", () => {
    const out = findDuplicateCandidates(
      p("x", { domain: "shop.acme.co.za", phones: ["+27411234567"], emails: ["info@acme.co.za"] }),
      [p("y", { domain: "acme.co.za", phones: ["+27411234567"], emails: ["info@acme.co.za"] })],
      0.99,
    );
    expect(out.map((c) => c.matchBasis)).toEqual(["domain", "phone", "email"]);
  });

  it("never pairs a company with itself and ignores unrelated domains", () => {
    expect(findDuplicateCandidates(p("a", { domain: "acme.co.za" }), [p("a"), p("b", { domain: "acme.com" })], 0.99)).toEqual([]);
  });
});
