// Validation of one company as entered by hand or read from a CSV row. Pure: no I/O.
// Every problem is reported; nothing is silently dropped or corrected beyond normalisation.
import { normaliseEmail, normalisePhone } from "../identity/contact";
import { normaliseDomain } from "../identity/domain";
import { normaliseCompanyName, splitTradingAs } from "../identity/name";

export const COMPANY_FIELDS = ["name", "website", "legal_name", "trading_name", "industry", "location", "phone", "email"] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];
export type CompanyInput = Partial<Record<CompanyField, string>>;

export interface Issue {
  code: string;
  field?: CompanyField;
  message: string;
}

export interface ValidCompany {
  displayName: string;
  normalisedName: string;
  /** Normalised identity domain, or null when none was given or it is a shared platform. */
  domain: string | null;
  /** Website exactly as given (trimmed), kept for evidence. */
  website: string | null;
  /** Set when the website is a shared platform page rather than the company's own domain. */
  webPresenceUrl: string | null;
  legalName: string | null;
  tradingName: string | null;
  industry: string | null;
  location: string | null;
  phone: { raw: string; normalised: string } | null;
  email: { raw: string; normalised: string } | null;
}

export type ValidationResult =
  | { ok: true; company: ValidCompany; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

const MAX_NAME = 200;
const MAX_TEXT = 500;

const clean = (v: string | undefined): string | null => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

export function validateCompanyInput(input: CompanyInput): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  for (const field of COMPANY_FIELDS) {
    const v = input[field];
    if (v !== undefined && v.length > MAX_TEXT) {
      errors.push({ code: "too_long", field, message: `${field} is longer than ${MAX_TEXT} characters` });
    }
  }

  // Name, with "X t/a Y" split into a legal name and a trading name.
  const rawName = clean(input.name);
  let displayName: string | null = null;
  let legalName = clean(input.legal_name);
  let tradingName = clean(input.trading_name);
  let normalisedName = "";
  if (rawName === null) {
    errors.push({ code: "name_missing", field: "name", message: "Company name is required" });
  } else if (rawName.length > MAX_NAME) {
    errors.push({ code: "name_too_long", field: "name", message: `Company name is longer than ${MAX_NAME} characters` });
  } else {
    const split = splitTradingAs(rawName);
    if (split.tradingAs) {
      displayName = split.tradingAs;
      legalName ??= split.name;
      tradingName ??= split.tradingAs;
    } else {
      displayName = rawName;
    }
    normalisedName = normaliseCompanyName(displayName);
    if (normalisedName === "" || normaliseCompanyName(`x ${displayName}`) === "x") {
      errors.push({
        code: "name_not_meaningful",
        field: "name",
        message: `"${rawName}" has no name left after removing punctuation and legal form`,
      });
    }
  }

  // Website → identity domain.
  const website = clean(input.website);
  let domain: string | null = null;
  let webPresenceUrl: string | null = null;
  if (website !== null) {
    const r = normaliseDomain(website);
    if (r.ok) domain = r.domain;
    else if (r.issue === "shared_platform_host") {
      webPresenceUrl = website;
      warnings.push({
        code: "shared_platform_host",
        field: "website",
        message: `${r.message}; imported without a domain`,
      });
    } else {
      errors.push({ code: `website_${r.issue}`, field: "website", message: r.message });
    }
  } else {
    warnings.push({ code: "no_website", field: "website", message: "No website given; imported without a domain" });
  }

  const phoneRaw = clean(input.phone);
  let phone: ValidCompany["phone"] = null;
  if (phoneRaw !== null) {
    const r = normalisePhone(phoneRaw);
    if (r.ok) phone = { raw: phoneRaw, normalised: r.value };
    else errors.push({ code: "phone_invalid", field: "phone", message: r.message });
  }

  const emailRaw = clean(input.email);
  let email: ValidCompany["email"] = null;
  if (emailRaw !== null) {
    const r = normaliseEmail(emailRaw);
    if (r.ok) email = { raw: emailRaw, normalised: r.value };
    else errors.push({ code: "email_invalid", field: "email", message: r.message });
  }

  if (errors.length > 0 || displayName === null) return { ok: false, errors, warnings };
  return {
    ok: true,
    warnings,
    company: {
      displayName,
      normalisedName,
      domain,
      website,
      webPresenceUrl,
      legalName,
      tradingName,
      industry: clean(input.industry),
      location: clean(input.location),
      phone,
      email,
    },
  };
}

// --- CSV header mapping ---------------------------------------------------

const HEADER_ALIASES: Record<string, CompanyField> = {
  name: "name",
  company: "name",
  company_name: "name",
  business_name: "name",
  website: "website",
  web_site: "website",
  url: "website",
  domain: "website",
  legal_name: "legal_name",
  registered_name: "legal_name",
  trading_name: "trading_name",
  trading_as: "trading_name",
  industry: "industry",
  sector: "industry",
  location: "location",
  city: "location",
  town: "location",
  area: "location",
  phone: "phone",
  telephone: "phone",
  tel: "phone",
  phone_number: "phone",
  email: "email",
  e_mail: "email",
  email_address: "email",
};

export type HeaderMapping =
  | { ok: true; columns: (CompanyField | null)[]; ignored: string[] }
  | { ok: false; message: string };

export function mapCsvHeader(header: string[]): HeaderMapping {
  const columns: (CompanyField | null)[] = [];
  const ignored: string[] = [];
  const seen = new Map<CompanyField, string>();
  for (const h of header) {
    const key = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const field = HEADER_ALIASES[key] ?? null;
    if (field === null) {
      ignored.push(h);
    } else if (seen.has(field)) {
      return { ok: false, message: `Columns "${seen.get(field)}" and "${h}" both map to ${field}` };
    } else {
      seen.set(field, h);
    }
    columns.push(field);
  }
  if (!seen.has("name")) {
    return { ok: false, message: "No company name column (expected one of: name, company, company name, business name)" };
  }
  return { ok: true, columns, ignored };
}

export function rowToInput(columns: (CompanyField | null)[], values: string[]): CompanyInput {
  const input: CompanyInput = {};
  columns.forEach((field, i) => {
    if (field !== null && values[i] !== undefined) input[field] = values[i];
  });
  return input;
}
