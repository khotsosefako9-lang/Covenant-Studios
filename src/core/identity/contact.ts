// Phone and email normalisation for duplicate detection. Pure: no I/O.

export type ContactResult = { ok: true; value: string } | { ok: false; message: string };

/**
 * South African numbers to E.164 (+27 followed by 9 digits). International numbers
 * written with "+" or "00" keep their country code. Extensions are not supported.
 */
export function normalisePhone(input: string): ContactResult {
  const raw = input.trim();
  if (raw === "") return { ok: false, message: "No phone number given" };
  if (/[a-z]/i.test(raw)) return { ok: false, message: `"${raw}" contains letters` };
  const plus = raw.startsWith("+");
  let digits = raw.replace(/\(0\)/g, "").replace(/\D/g, "");
  if (!plus && digits.startsWith("00")) digits = digits.slice(2);
  else if (!plus && digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  else if (!plus && !digits.startsWith("27")) {
    return { ok: false, message: `"${raw}" has no country or area code` };
  }
  if (digits.startsWith("27")) {
    if (digits.length !== 11) return { ok: false, message: `"${raw}" is not a valid South African number` };
  } else if (digits.length < 8 || digits.length > 15) {
    return { ok: false, message: `"${raw}" is not a valid phone number` };
  }
  return { ok: true, value: `+${digits}` };
}

const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Trim and lower-case; reject anything that is not a plain address. */
export function normaliseEmail(input: string): ContactResult {
  const value = input.trim().replace(/^mailto:/i, "").toLowerCase();
  if (value === "") return { ok: false, message: "No email address given" };
  if (value.length > 254 || !EMAIL.test(value) || value.includes("..")) {
    return { ok: false, message: `"${input.trim()}" is not a valid email address` };
  }
  return { ok: true, value };
}
