import { describe, expect, it } from "vitest";
import { parseCsv } from "@/core/csv";

const values = (text: string) => {
  const r = parseCsv(text);
  if (!r.ok) throw new Error(r.message);
  return r.records.map((x) => x.values);
};

describe("parseCsv", () => {
  it("parses plain rows", () => {
    expect(values("name,website\nAcme,acme.co.za\n")).toEqual([["name", "website"], ["Acme", "acme.co.za"]]);
  });

  it("handles CRLF, CR, a BOM and a missing final newline", () => {
    expect(values("﻿a,b\r\n1,2\r3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("handles quoted commas, escaped quotes and embedded newlines", () => {
    expect(values('name,notes\n"Smith, Jones & Co","He said ""hi""\nthen left"\n')).toEqual([
      ["name", "notes"],
      ["Smith, Jones & Co", 'He said "hi"\nthen left'],
    ]);
  });

  it("keeps empty fields and skips blank lines", () => {
    expect(values("a,b,c\n\n1,,3\n,,\n")).toEqual([["a", "b", "c"], ["1", "", "3"], ["", "", ""]]);
    expect(values('a\n""\n')).toEqual([["a"], [""]]);
  });

  it("reports the starting line of each record, counting embedded newlines", () => {
    const r = parseCsv('a,b\n"x\ny",1\nz,2\n');
    expect(r.ok && r.records.map((x) => x.line)).toEqual([1, 2, 4]);
  });

  it("returns an empty list for empty input", () => {
    expect(values("")).toEqual([]);
  });

  it.each([
    ['a\n"unterminated\n', "Unterminated quoted field"],
    ['a\nab"c\n', "Quote inside an unquoted field"],
    ['a\n"ab"c\n', "Unexpected character after a closing quote"],
  ])("rejects malformed quoting: %j", (text, message) => {
    const r = parseCsv(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toBe(message);
      expect(r.line).toBe(2);
    }
  });
});
