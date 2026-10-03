// Domain normalisation. Pure: no I/O. The result is the company's primary identity key.

export type DomainIssue =
  | "empty"
  | "email_address"
  | "unparseable"
  | "ip_address"
  | "no_public_suffix"
  | "invalid_label"
  | "too_long"
  | "shared_platform_host";

export type DomainResult =
  | { ok: true; domain: string }
  | { ok: false; issue: DomainIssue; message: string };

// Hosts where many unrelated businesses live under one domain (path-based profiles).
// A company whose only web presence is one of these has no domain of its own.
export const SHARED_PLATFORM_HOSTS: readonly string[] = [
  "facebook.com",
  "fb.com",
  "m.facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "linktr.ee",
  "wa.me",
  "api.whatsapp.com",
  "google.com",
  "sites.google.com",
  "maps.google.com",
  "goo.gl",
  "maps.app.goo.gl",
  "bit.ly",
];

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

const fail = (issue: DomainIssue, message: string): DomainResult => ({ ok: false, issue, message });

/**
 * Reduce a website or domain as typed by a person to a normalised host:
 * lower case, punycode for IDNs, no scheme, credentials, port, path, trailing dot or
 * leading "www.". Subdomains other than "www" are kept: collapsing to the registrable
 * domain needs the public suffix list, and subdomain relations are surfaced as
 * duplicate candidates instead.
 */
export function normaliseDomain(input: string): DomainResult {
  const raw = input.trim();
  if (raw === "") return fail("empty", "No website or domain given");
  if (/^[^/\s]+@[^/\s]+$/.test(raw) && !/^[a-z]+:\/\//i.test(raw)) {
    return fail("email_address", `"${raw}" is an email address, not a website`);
  }
  if (/\s/.test(raw)) return fail("unparseable", `"${raw}" contains whitespace`);

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let host: string;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fail("unparseable", `"${raw}" is not a web address`);
    }
    host = url.hostname;
  } catch {
    return fail("unparseable", `"${raw}" is not a valid website`);
  }

  host = host.replace(/\.$/, "");
  if (/^\[.*\]$/.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return fail("ip_address", `"${raw}" is an IP address, not a company domain`);
  }
  if (host.startsWith("www.")) host = host.slice(4);

  const labels = host.split(".");
  if (labels.length < 2) return fail("no_public_suffix", `"${raw}" has no domain suffix (e.g. .co.za)`);
  if (host.length > 253) return fail("too_long", `"${raw}" is longer than a domain can be`);
  if (!labels.every((l) => LABEL.test(l))) return fail("invalid_label", `"${raw}" is not a valid domain`);
  const tld = labels[labels.length - 1] as string;
  if (/^\d+$/.test(tld)) return fail("invalid_label", `"${raw}" is not a valid domain`);

  if (SHARED_PLATFORM_HOSTS.includes(host)) {
    return fail("shared_platform_host", `"${host}" is a shared platform, not the company's own domain`);
  }
  return { ok: true, domain: host };
}

/** True when one host is a subdomain of the other (shop.acme.co.za vs acme.co.za). */
export function isSubdomainRelated(a: string, b: string): boolean {
  return a !== b && (a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}
