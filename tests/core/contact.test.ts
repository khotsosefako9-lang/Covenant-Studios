import { describe, expect, it } from "vitest";
import { normaliseEmail, normalisePhone } from "@/core/identity/contact";

describe("normalisePhone", () => {
  it.each([
    ["041 123 4567", "+27411234567"],
    ["0411234567", "+27411234567"],
    ["(041) 123-4567", "+27411234567"],
    ["+27 41 123 4567", "+27411234567"],
    ["+27 (0)41 123 4567", "+27411234567"],
    ["0027 41 123 4567", "+27411234567"],
    ["27411234567", "+27411234567"],
    ["082 555 1234", "+27825551234"],
    ["+44 20 7946 0958", "+442079460958"],
    ["0044 20 7946 0958", "+442079460958"],
  ])("%s → %s", (input, expected) => {
    expect(normalisePhone(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "  ", "041 123 456", "041 123 45678", "call us", "1234567", "+12", "4112345678"])(
    "%j is rejected",
    (input) => {
      expect(normalisePhone(input).ok).toBe(false);
    },
  );
});

describe("normaliseEmail", () => {
  it.each([
    ["info@acme.co.za", "info@acme.co.za"],
    ["  Info@ACME.co.za ", "info@acme.co.za"],
    ["mailto:sales@acme.co.za", "sales@acme.co.za"],
    ["first.last+tag@acme.co.za", "first.last+tag@acme.co.za"],
  ])("%s → %s", (input, expected) => {
    expect(normaliseEmail(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "acme.co.za", "info@", "@acme.co.za", "info@acme", "in fo@acme.co.za", "info@@acme.co.za", "info..x@acme.co.za"])(
    "%j is rejected",
    (input) => {
      expect(normaliseEmail(input).ok).toBe(false);
    },
  );
});
