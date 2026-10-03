import { describe, expect, it } from "vitest";
import { mapCsvHeader, rowToInput, validateCompanyInput } from "@/core/ingest/validate";

const codes = (input: Parameters<typeof validateCompanyInput>[0]) => {
  const r = validateCompanyInput(input);
  return r.ok ? [] : r.errors.map((e) => e.code).sort();
};

describe("validateCompanyInput", () => {
  it("normalises a complete row", () => {
    const r = validateCompanyInput({
      name: "  Acme   Supplies (Pty) Ltd ",
      website: "https://www.ACME.co.za/about",
      phone: "041 123 4567",
      email: " Info@Acme.co.za ",
      industry: " Industrial ",
      location: "Gqeberha",
    });
    expect(r).toEqual({
      ok: true,
      warnings: [],
      company: {
        displayName: "Acme Supplies (Pty) Ltd",
        normalisedName: "acme supplies",
        domain: "acme.co.za",
        website: "https://www.ACME.co.za/about",
        webPresenceUrl: null,
        legalName: null,
        tradingName: null,
        industry: "Industrial",
        location: "Gqeberha",
        phone: { raw: "041 123 4567", normalised: "+27411234567" },
        email: { raw: "Info@Acme.co.za", normalised: "info@acme.co.za" },
      },
    });
  });

  it("splits trading-as names and keeps explicit legal/trading names", () => {
    const r = validateCompanyInput({ name: "Bay Holdings (Pty) Ltd t/a Coastal Pumps", website: "coastal.co.za" });
    expect(r.ok && [r.company.displayName, r.company.legalName, r.company.tradingName]).toEqual([
      "Coastal Pumps",
      "Bay Holdings (Pty) Ltd",
      "Coastal Pumps",
    ]);
    const r2 = validateCompanyInput({ name: "X t/a Y", legal_name: "Registered X", website: "y.co.za" });
    expect(r2.ok && r2.company.legalName).toBe("Registered X");
  });

  it("warns, not fails, when there is no website or only a shared-platform page", () => {
    const none = validateCompanyInput({ name: "Acme" });
    expect(none.ok && none.company.domain).toBeNull();
    expect(none.warnings.map((w) => w.code)).toEqual(["no_website"]);
    const fb = validateCompanyInput({ name: "Acme", website: "facebook.com/acme" });
    expect(fb.ok && [fb.company.domain, fb.company.webPresenceUrl]).toEqual([null, "facebook.com/acme"]);
    expect(fb.warnings.map((w) => w.code)).toEqual(["shared_platform_host"]);
  });

  it.each([
    [{}, ["name_missing"]],
    [{ name: "   " }, ["name_missing"]],
    [{ name: "x".repeat(201) }, ["name_too_long"]],
    [{ name: "(Pty) Ltd" }, ["name_not_meaningful"]],
    [{ name: "!!!" }, ["name_not_meaningful"]],
    [{ name: "Acme", website: "not a site" }, ["website_unparseable"]],
    [{ name: "Acme", website: "info@acme.co.za" }, ["website_email_address"]],
    [{ name: "Acme", phone: "12" }, ["phone_invalid"]],
    [{ name: "Acme", email: "nope" }, ["email_invalid"]],
    [{ name: "Acme", industry: "x".repeat(501) }, ["too_long"]],
    [{ name: "", website: "bad", phone: "1", email: "e" }, ["email_invalid", "name_missing", "phone_invalid", "website_no_public_suffix"]],
  ])("%j fails with %j", (input, expected) => {
    expect(codes(input)).toEqual(expected);
  });
});

describe("mapCsvHeader", () => {
  it("maps known aliases case- and punctuation-insensitively and reports ignored columns", () => {
    const m = mapCsvHeader(["Company Name", "Web-Site", "E-mail", "Tel", "City", "Notes", "Owner"]);
    expect(m).toEqual({ ok: true, columns: ["name", "website", "email", "phone", "location", null, null], ignored: ["Notes", "Owner"] });
  });

  it.each([
    [["website", "phone"], "No company name column"],
    [["name", "company"], "both map to name"],
    [["name", "website", "url"], "both map to website"],
  ])("%j is rejected", (header, message) => {
    const m = mapCsvHeader(header);
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.message).toContain(message);
  });

  it("builds an input from a row, skipping ignored columns", () => {
    expect(rowToInput(["name", null, "website"], ["Acme", "note", "acme.co.za"])).toEqual({ name: "Acme", website: "acme.co.za" });
  });
});
