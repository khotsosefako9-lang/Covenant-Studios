import { describe, expect, it } from "vitest";
import { nameSimilarity, normaliseCompanyName, splitTradingAs } from "@/core/identity/name";

describe("normaliseCompanyName", () => {
  it.each([
    ["Acme Supplies", "acme supplies"],
    ["  ACME   Supplies  ", "acme supplies"],
    ["Acme Supplies (Pty) Ltd", "acme supplies"],
    ["Acme Supplies (PTY) LTD.", "acme supplies"],
    ["Acme Supplies Pty Ltd", "acme supplies"],
    ["Acme Supplies Proprietary Limited", "acme supplies"],
    ["Acme Supplies Limited", "acme supplies"],
    ["Acme Supplies CC", "acme supplies"],
    ["Acme Supplies cc.", "acme supplies"],
    ["Acme Supplies NPC", "acme supplies"],
    ["Acme Holdings SOC Ltd", "acme holdings"],
    ["Acme (RF) (Pty) Ltd", "acme"],
    ["Acme Inc.", "acme"],
    ["Smith & Sons", "smith and sons"],
    ["Smith and Sons", "smith and sons"],
    ["O'Brien's Plumbing", "obriens plumbing"],
    ["O’Brien’s Plumbing", "obriens plumbing"],
    ["Café Délice", "cafe delice"],
    ["The Gqeberha Rugby Union", "gqeberha rugby union"],
    ["The", "the"],
    ["Covenant Kreative (Pty) Ltd", "covenant kreative"],
    ["Covenant Digital Marketing", "covenant digital marketing"],
    ["Acme Group", "acme group"],
    ["E.C. Engineering", "e c engineering"],
    ["(Pty) Ltd", "pty ltd"],
    ["Ltd", "ltd"],
    ["", ""],
    ["!!!", ""],
  ])("%j → %j", (input, expected) => {
    expect(normaliseCompanyName(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const n of ["Acme Supplies (Pty) Ltd", "Smith & Sons", "Café Délice"]) {
      const once = normaliseCompanyName(n);
      expect(normaliseCompanyName(once)).toBe(once);
    }
  });
});

describe("splitTradingAs", () => {
  it.each([
    ["Bay Holdings (Pty) Ltd t/a Acme Pumps", "Bay Holdings (Pty) Ltd", "Acme Pumps"],
    ["Bay Holdings T/A Acme Pumps", "Bay Holdings", "Acme Pumps"],
    ["Bay Holdings trading as Acme Pumps", "Bay Holdings", "Acme Pumps"],
    ["Acme Pumps", "Acme Pumps", null],
    ["Data Analytics", "Data Analytics", null],
  ])("%j", (input, name, tradingAs) => {
    expect(splitTradingAs(input)).toEqual({ name, tradingAs });
  });
});

describe("nameSimilarity", () => {
  it("is 1 for identical names and 0 for empty ones", () => {
    expect(nameSimilarity("acme supplies", "acme supplies")).toBe(1);
    expect(nameSimilarity("", "")).toBe(0);
    expect(nameSimilarity("", "acme")).toBe(0);
  });

  it("is symmetric and bounded", () => {
    const pairs = [
      ["acme supplies", "acme supply"],
      ["covenant kreative", "covenant digital marketing"],
      ["bay engineering", "zulu catering"],
    ] as const;
    for (const [a, b] of pairs) {
      const s = nameSimilarity(a, b);
      expect(s).toBe(nameSimilarity(b, a));
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("ranks near-identical names above merely related ones", () => {
    const typo = nameSimilarity("acme supplies", "acme suplies");
    const related = nameSimilarity("covenant kreative", "covenant digital marketing");
    const unrelated = nameSimilarity("bay engineering", "zulu catering");
    expect(typo).toBeGreaterThan(0.6);
    expect(related).toBeLessThan(0.6);
    expect(unrelated).toBeLessThan(related);
  });
});
