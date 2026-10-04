// Technical checks. Each states only what the retrieved responses show.
import type { Element } from "domhandler";
import { excerptOf, pathOf, resolveHref, sameSite, textOf, visible } from "../document";
import type { CheckDefinition, EvidenceItem, Probe } from "../types";
import { fail, indeterminate, notApplicable, pass } from "./result";

const V = "1";

// TLS errors a browser would also refuse. Chain problems (missing intermediates) are not
// here: browsers often repair them, Node does not, so they are INDETERMINATE.
const DEFINITE_TLS = /(CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID|HOSTNAME_MISMATCH|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|CERT_NOT_YET_VALID|CERT_REVOKED)/;

const probeEvidence = (p: Probe, claim: string): EvidenceItem => ({
  claim,
  value: `${p.outcome}${p.httpStatus ? ` ${p.httpStatus}` : ""}`,
  excerpt: p.detail,
  locator: `GET ${p.url}${p.finalUrl && p.finalUrl !== p.url ? ` → ${p.finalUrl}` : ""}`,
  sourceRecordId: p.sourceRecordId,
});

export const technicalChecks: CheckDefinition[] = [
  {
    key: "tech.https",
    name: "Homepage served over HTTPS",
    category: "technical",
    severity: "high",
    version: V,
    description: "Requests https://<domain>/. FAIL only when HTTPS could not be reached at all while HTTP could.",
    evidenceRecorded: "Outcome of the HTTPS request and, on FAIL, of the HTTP request that succeeded.",
    run(ctx) {
      const h = ctx.https;
      if (!h) return indeterminate("HTTPS was not attempted");
      const ev: EvidenceItem = { claim: "Result of requesting the homepage over HTTPS", value: h.outcome, excerpt: h.detail, locator: "GET https://", sourceRecordId: h.sourceRecordId };
      if (h.outcome === "OK") return pass("Homepage loads over HTTPS", 0.99, [ev]);
      if (h.outcome === "TLS_ERROR") return notApplicable("HTTPS answered with a certificate problem; see tech.certificate_valid");
      if ((h.outcome === "UNREACHABLE" || h.outcome === "TIMEOUT") && ctx.doc.url.protocol === "http:") {
        return fail("HTTPS could not be reached, but the homepage loads over plain HTTP", 0.9, [
          ev,
          { claim: "Homepage retrieved over plain HTTP", value: ctx.doc.url.toString(), locator: `GET ${ctx.doc.url}`, sourceRecordId: ctx.pageSourceRecordId },
        ]);
      }
      return indeterminate(`HTTPS request ended ${h.outcome}; cannot tell whether HTTPS is offered`, [ev]);
    },
  },
  {
    key: "tech.certificate_valid",
    name: "TLS certificate valid",
    category: "technical",
    severity: "high",
    version: V,
    description: "FAIL only for errors browsers also reject (expired, wrong hostname, self-signed). Chain errors are INDETERMINATE.",
    evidenceRecorded: "The TLS error code returned for the HTTPS request.",
    run(ctx) {
      const h = ctx.https;
      if (!h) return indeterminate("HTTPS was not attempted");
      if (h.outcome === "OK") return pass("Certificate accepted with verification on", 0.97);
      if (h.outcome !== "TLS_ERROR") return notApplicable(`HTTPS request ended ${h.outcome}; no certificate to judge`);
      const ev: EvidenceItem = { claim: "TLS error on the HTTPS request", value: h.detail, locator: "TLS handshake", sourceRecordId: h.sourceRecordId };
      const code = h.detail?.match(DEFINITE_TLS)?.[1];
      if (code) return fail(`Certificate rejected: ${code}`, 0.95, [ev]);
      return indeterminate("TLS failed with an error browsers may work around (e.g. an incomplete certificate chain)", [ev]);
    },
  },
  {
    key: "tech.http_redirects_to_https",
    name: "HTTP redirects to HTTPS",
    category: "technical",
    severity: "medium",
    version: V,
    description: "Requests http://<domain>/ and checks where it ends.",
    evidenceRecorded: "The HTTP request's outcome and final URL.",
    run(ctx) {
      if (!ctx.https) return indeterminate("HTTPS was not attempted");
      if (ctx.https.outcome !== "OK") return notApplicable(`HTTPS request ended ${ctx.https.outcome}, so there is nothing to redirect to`);
      const p = ctx.httpVariant;
      if (!p) return indeterminate("The HTTP variant was not requested");
      const ev = probeEvidence(p, "Result of requesting the homepage over plain HTTP");
      if (p.outcome === "OK" && p.finalUrl?.startsWith("https://")) return pass("HTTP redirects to HTTPS", 0.97, [ev]);
      if (p.outcome === "OK" && p.finalUrl?.startsWith("http://")) return fail("The homepage is also served over plain HTTP without redirecting", 0.9, [ev]);
      return indeterminate(`HTTP request ended ${p.outcome}`, [ev]);
    },
  },
  {
    key: "tech.viewport_meta",
    name: "Mobile viewport declared",
    category: "technical",
    severity: "medium",
    version: V,
    description: "PASS when <meta name=viewport> sets width=device-width.",
    evidenceRecorded: "The viewport meta tag, or its absence from <head>.",
    run({ doc }) {
      const el = doc.$("meta[name='viewport' i]").get(0) as Element | undefined;
      if (!el) return fail("No viewport meta tag: phones render the desktop layout zoomed out", 0.95, [{ claim: "No <meta name=viewport> in the document", value: null, locator: "head" }]);
      const content = doc.$(el).attr("content") ?? "";
      const ev = { claim: "Viewport meta tag", value: content, excerpt: excerptOf(doc.$, el), locator: pathOf(el) };
      if (/width\s*=\s*device-width/i.test(content)) return pass("Viewport is set to device width", 0.95, [ev]);
      return fail("Viewport meta tag does not set width=device-width", 0.85, [ev]);
    },
  },
  {
    key: "tech.html_weight",
    name: "HTML document weight",
    category: "technical",
    severity: "low",
    version: V,
    description: "Size of the HTML document alone (not images, scripts or styles, which are not downloaded); FAIL above max_html_bytes (default 1 MB).",
    evidenceRecorded: "HTML byte size and counts of referenced scripts, stylesheets and images.",
    params: { max_html_bytes: { default: 1_000_000, min: 200_000, max: 10_000_000, integer: true, description: "FAIL when the HTML document is larger than this many bytes" } },
    run({ doc }, p) {
      const bytes = Buffer.byteLength(doc.html, "utf8");
      const counts = `${doc.$("script[src]").length} scripts, ${doc.$("link[rel~='stylesheet' i]").length} stylesheets, ${doc.$("img").length} images referenced`;
      const ev = { claim: "HTML document size", value: `${bytes} bytes`, excerpt: counts, locator: "document" };
      if (bytes > (p.max_html_bytes as number)) return fail(`The HTML document alone is ${(bytes / 1_000_000).toFixed(1)} MB`, 0.95, [ev]);
      return pass(`HTML document is ${Math.round(bytes / 1024)} KB`, 0.95, [ev]);
    },
  },
  {
    key: "tech.response_time",
    name: "Server response time",
    category: "technical",
    severity: "low",
    version: V,
    description: "Time to response headers, one measurement from the audit server; FAIL above max_response_ms (default 3 seconds).",
    evidenceRecorded: "Measured milliseconds to response headers.",
    params: { max_response_ms: { default: 3000, min: 1000, max: 30_000, integer: true, description: "FAIL when the response headers took longer than this many milliseconds" } },
    run(ctx, p) {
      if (ctx.responseMs === null) return indeterminate("No timing was recorded for this retrieval");
      const ev = { claim: "Time to response headers, measured once from the audit server", value: `${ctx.responseMs} ms`, locator: `GET ${ctx.doc.url}`, sourceRecordId: ctx.pageSourceRecordId };
      if (ctx.responseMs > (p.max_response_ms as number)) return fail(`The server took ${(ctx.responseMs / 1000).toFixed(1)} s to respond (one measurement)`, 0.5, [ev]);
      return pass(`The server responded in ${ctx.responseMs} ms`, 0.6, [ev]);
    },
  },
  {
    key: "tech.title",
    name: "Page title present",
    category: "technical",
    severity: "medium",
    version: V,
    description: "PASS for a non-empty, non-placeholder <title>.",
    evidenceRecorded: "The <title> text.",
    run({ doc }) {
      const el = doc.$("head title, title").get(0) as Element | undefined;
      const t = el ? doc.$(el).text().replace(/\s+/g, " ").trim() : "";
      if (!el || !t) return fail("The page has no title", 0.97, [{ claim: "No non-empty <title> element", value: null, locator: "head" }]);
      const ev = { claim: "Page title", value: t, locator: pathOf(el) };
      if (/^(home|homepage|index|untitled|untitled document|new page|my site|wordpress)$/i.test(t)) {
        return fail(`The title is a placeholder ("${t}")`, 0.9, [ev], "low");
      }
      return pass("Page has a title", 0.97, [ev]);
    },
  },
  {
    key: "tech.meta_description",
    name: "Meta description present",
    category: "technical",
    severity: "low",
    version: V,
    description: "PASS for a non-empty <meta name=description>.",
    evidenceRecorded: "The meta description text.",
    run({ doc }) {
      const el = doc.$("meta[name='description' i]").get(0) as Element | undefined;
      const c = el ? (doc.$(el).attr("content") ?? "").trim() : "";
      if (!c) return fail("No meta description", 0.95, [{ claim: "No non-empty <meta name=description>", value: null, locator: "head" }]);
      return pass("Meta description present", 0.95, [{ claim: "Meta description", value: c, locator: pathOf(el as Element) }]);
    },
  },
  {
    key: "tech.canonical",
    name: "Canonical URL declared",
    category: "technical",
    severity: "low",
    version: V,
    description: "PASS for a canonical link on the same site; FAIL (low) when it points to another site; FAIL (info) when absent.",
    evidenceRecorded: "The canonical link href.",
    run({ doc }) {
      const el = doc.$("link[rel~='canonical' i]").get(0) as Element | undefined;
      if (!el) return fail("No canonical link", 0.9, [{ claim: "No <link rel=canonical>", value: null, locator: "head" }], "info");
      const href = doc.$(el).attr("href");
      const u = resolveHref(doc, href);
      const ev = { claim: "Canonical link", value: href ?? null, locator: pathOf(el) };
      if (!u) return indeterminate("Canonical link has no usable href", [ev]);
      if (!sameSite(u, doc.url)) return fail(`Canonical points to another site (${u.hostname})`, 0.85, [ev]);
      return pass("Canonical link on the same site", 0.9, [ev]);
    },
  },
  {
    key: "tech.indexable",
    name: "Homepage indexable",
    category: "technical",
    severity: "high",
    version: V,
    description: "FAIL when a robots meta tag or X-Robots-Tag header says noindex (or none).",
    evidenceRecorded: "The robots meta tag and X-Robots-Tag header values.",
    run(ctx) {
      const { doc } = ctx;
      const metas = doc.$("meta[name='robots' i], meta[name='googlebot' i]").toArray() as Element[];
      for (const el of metas) {
        const c = (doc.$(el).attr("content") ?? "").toLowerCase();
        if (/\b(noindex|none)\b/.test(c)) {
          return fail("The homepage tells search engines not to index it", 0.97, [{ claim: "Robots meta tag", value: c, excerpt: excerptOf(doc.$, el), locator: pathOf(el) }]);
        }
      }
      const header = ctx.headers["x-robots-tag"];
      if (header && /\b(noindex|none)\b/i.test(header)) {
        return fail("The homepage response tells search engines not to index it", 0.97, [{ claim: "X-Robots-Tag response header", value: header, locator: "response headers", sourceRecordId: ctx.pageSourceRecordId }]);
      }
      return pass("No noindex directive found", 0.95);
    },
  },
  {
    key: "tech.sitemap",
    name: "Sitemap reachable",
    category: "technical",
    severity: "info",
    version: V,
    description: "Requests the sitemap named in robots.txt, else /sitemap.xml. PASS for 200 with an XML type.",
    evidenceRecorded: "The sitemap request's status and content type.",
    run(ctx) {
      const p = ctx.sitemap;
      if (!p) return indeterminate("No sitemap request was made");
      const ev = probeEvidence(p, "Result of requesting the sitemap");
      const xml = /xml|gzip/i.test(p.contentType ?? "");
      if (p.httpStatus === 200 && xml) return pass("Sitemap is reachable", 0.95, [ev]);
      if (p.httpStatus === 404 || p.httpStatus === 410) return fail("No sitemap at the expected location", 0.6, [ev]);
      return indeterminate(`Sitemap request ended ${p.outcome}${p.httpStatus ? ` ${p.httpStatus}` : ""}${p.contentType ? ` (${p.contentType})` : ""}`, [ev]);
    },
  },
  {
    key: "tech.headings",
    name: "Single h1 and ordered headings",
    category: "technical",
    severity: "low",
    version: V,
    description: "FAIL (low) with no visible h1; FAIL (info) for several h1s or skipped heading levels.",
    evidenceRecorded: "The h1 text(s) and any skipped level.",
    run({ doc }) {
      const hs = visible(doc, "h1, h2, h3, h4, h5, h6");
      const h1 = hs.filter((h) => h.name === "h1");
      const ev = h1.map((h) => ({ claim: "h1 heading", value: textOf(doc.$, h), locator: pathOf(h) }));
      if (h1.length === 0) return fail("No h1 heading on the page", 0.9, [{ claim: "No visible <h1>", value: null, locator: "body" }]);
      let skip: string | null = null;
      let prev = 0;
      for (const h of hs) {
        const level = Number(h.name.slice(1));
        if (prev && level > prev + 1) {
          skip = `h${prev} followed by h${level} at ${pathOf(h)}`;
          break;
        }
        prev = level;
      }
      if (h1.length > 1) return fail(`${h1.length} h1 headings`, 0.8, ev, "info");
      if (skip) return fail(`Heading level skipped: ${skip}`, 0.7, [...ev, { claim: "Skipped heading level", value: skip, locator: "body" }], "info");
      return pass("One h1 and headings in order", 0.9, ev);
    },
  },
  {
    key: "tech.broken_internal_links",
    name: "Internal links resolve (sample)",
    category: "technical",
    severity: "medium",
    version: V,
    description: "Requests up to 5 internal links from the homepage, in document order. FAIL when one returns 404 or 410.",
    evidenceRecorded: "Each sampled link's URL and status.",
    run(ctx) {
      if (ctx.links.length === 0) return notApplicable("No internal links were sampled");
      const broken = ctx.links.filter((p) => p.httpStatus === 404 || p.httpStatus === 410);
      const ok = ctx.links.filter((p) => p.outcome === "OK");
      const ev = ctx.links.map((p) => probeEvidence(p, "Sampled internal link"));
      if (broken.length) return fail(`${broken.length} of ${ctx.links.length} sampled internal links are broken`, 0.9, ev);
      if (ok.length) return pass(`${ok.length} of ${ctx.links.length} sampled internal links resolved`, 0.85, ev);
      return indeterminate("None of the sampled links could be checked", ev);
    },
  },
];
