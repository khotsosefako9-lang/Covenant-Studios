// Technical checks. Each states only what the retrieved responses show.
import type { Element } from "domhandler";
import { excerptOf, pathOf, resolveHref, sameSite, textOf, visible } from "../document";
import type { CheckDefinition, EvidenceItem, Probe } from "../types";
import { fail, indeterminate, notApplicable, pass, conf } from "./result";

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
    confidences: {
      confidence_pass: { default: 0.99, min: 0.1, max: 1, description: "Confidence of the PASS result \"Homepage loads over HTTPS\"" },
      confidence_fail: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the FAIL result \"HTTPS could not be reached, but the homepage loads over plain HTTP\"" },
    },
    run(ctx, cfg) {
      const h = ctx.https;
      if (!h) return indeterminate("HTTPS was not attempted");
      const ev: EvidenceItem = { claim: "Result of requesting the homepage over HTTPS", value: h.outcome, excerpt: h.detail, locator: "GET https://", sourceRecordId: h.sourceRecordId };
      if (h.outcome === "OK") return pass("Homepage loads over HTTPS", conf(cfg, "confidence_pass"), [ev]);
      if (h.outcome === "TLS_ERROR") return notApplicable("HTTPS answered with a certificate problem; see tech.certificate_valid");
      if ((h.outcome === "UNREACHABLE" || h.outcome === "TIMEOUT") && ctx.doc.url.protocol === "http:") {
        return fail("HTTPS could not be reached, but the homepage loads over plain HTTP", conf(cfg, "confidence_fail"), [
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
    confidences: {
      confidence_pass: { default: 0.97, min: 0.1, max: 1, description: "Confidence of the PASS result \"Certificate accepted with verification on\"" },
      confidence_fail: { default: 0.95, min: 0.1, max: 1, description: "Confidence of the FAIL result \"Certificate rejected: …\"" },
    },
    run(ctx, cfg) {
      const h = ctx.https;
      if (!h) return indeterminate("HTTPS was not attempted");
      if (h.outcome === "OK") return pass("Certificate accepted with verification on", conf(cfg, "confidence_pass"));
      if (h.outcome !== "TLS_ERROR") return notApplicable(`HTTPS request ended ${h.outcome}; no certificate to judge`);
      const ev: EvidenceItem = { claim: "TLS error on the HTTPS request", value: h.detail, locator: "TLS handshake", sourceRecordId: h.sourceRecordId };
      const code = h.detail?.match(DEFINITE_TLS)?.[1];
      if (code) return fail(`Certificate rejected: ${code}`, conf(cfg, "confidence_fail"), [ev]);
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
    confidences: {
      confidence_pass: { default: 0.97, min: 0.1, max: 1, description: "Confidence of the PASS result \"HTTP redirects to HTTPS\"" },
      confidence_fail: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the FAIL result \"The homepage is also served over plain HTTP without redirecting\"" },
    },
    run(ctx, cfg) {
      if (!ctx.https) return indeterminate("HTTPS was not attempted");
      if (ctx.https.outcome !== "OK") return notApplicable(`HTTPS request ended ${ctx.https.outcome}, so there is nothing to redirect to`);
      const p = ctx.httpVariant;
      if (!p) return indeterminate("The HTTP variant was not requested");
      const ev = probeEvidence(p, "Result of requesting the homepage over plain HTTP");
      if (p.outcome === "OK" && p.finalUrl?.startsWith("https://")) return pass("HTTP redirects to HTTPS", conf(cfg, "confidence_pass"), [ev]);
      if (p.outcome === "OK" && p.finalUrl?.startsWith("http://")) return fail("The homepage is also served over plain HTTP without redirecting", conf(cfg, "confidence_fail"), [ev]);
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
    confidences: {
      confidence_fail_1: { default: 0.95, min: 0.1, max: 1, description: "Confidence of the FAIL result \"No viewport meta tag: phones render the desktop layout zoomed out\"" },
      confidence_pass: { default: 0.95, min: 0.1, max: 1, description: "Confidence of the PASS result \"Viewport is set to device width\"" },
      confidence_fail_2: { default: 0.85, min: 0.1, max: 1, description: "Confidence of the FAIL result \"Viewport meta tag does not set width=device-width\"" },
    },
    run({ doc }, cfg) {
      const el = doc.$("meta[name='viewport' i]").get(0) as Element | undefined;
      if (!el) return fail("No viewport meta tag: phones render the desktop layout zoomed out", conf(cfg, "confidence_fail_1"), [{ claim: "No <meta name=viewport> in the document", value: null, locator: "head" }]);
      const content = doc.$(el).attr("content") ?? "";
      const ev = { claim: "Viewport meta tag", value: content, excerpt: excerptOf(doc.$, el), locator: pathOf(el) };
      if (/width\s*=\s*device-width/i.test(content)) return pass("Viewport is set to device width", conf(cfg, "confidence_pass"), [ev]);
      return fail("Viewport meta tag does not set width=device-width", conf(cfg, "confidence_fail_2"), [ev]);
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
    confidences: {
      confidence_fail: { default: 0.95, min: 0.1, max: 1, description: "Confidence of the FAIL result \"The HTML document alone is … MB\"" },
      confidence_pass: { default: 0.95, min: 0.1, max: 1, description: "Confidence of the PASS result \"HTML document is … KB\"" },
    },
    run({ doc }, p) {
      const bytes = Buffer.byteLength(doc.html, "utf8");
      const counts = `${doc.$("script[src]").length} scripts, ${doc.$("link[rel~='stylesheet' i]").length} stylesheets, ${doc.$("img").length} images referenced`;
      const ev = { claim: "HTML document size", value: `${bytes} bytes`, excerpt: counts, locator: "document" };
      if (bytes > (p.max_html_bytes as number)) return fail(`The HTML document alone is ${(bytes / 1_000_000).toFixed(1)} MB`, conf(p, "confidence_fail"), [ev]);
      return pass(`HTML document is ${Math.round(bytes / 1024)} KB`, conf(p, "confidence_pass"), [ev]);
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
    confidences: {
      confidence_fail: { default: 0.5, min: 0.1, max: 1, description: "Confidence of the FAIL result \"The server took … s to respond (one measurement)\"" },
      confidence_pass: { default: 0.6, min: 0.1, max: 1, description: "Confidence of the PASS result \"The server responded in … ms\"" },
    },
    run(ctx, p) {
      if (ctx.responseMs === null) return indeterminate("No timing was recorded for this retrieval");
      const ev = { claim: "Time to response headers, measured once from the audit server", value: `${ctx.responseMs} ms`, locator: `GET ${ctx.doc.url}`, sourceRecordId: ctx.pageSourceRecordId };
      if (ctx.responseMs > (p.max_response_ms as number)) return fail(`The server took ${(ctx.responseMs / 1000).toFixed(1)} s to respond (one measurement)`, conf(p, "confidence_fail"), [ev]);
      return pass(`The server responded in ${ctx.responseMs} ms`, conf(p, "confidence_pass"), [ev]);
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
    confidences: {
      confidence_fail_1: { default: 0.97, min: 0.1, max: 1, description: "Confidence of the FAIL result \"The page has no title\"" },
      confidence_fail_2: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the FAIL result \"The title is a placeholder (\"…\")\"" },
      confidence_pass: { default: 0.97, min: 0.1, max: 1, description: "Confidence of the PASS result \"Page has a title\"" },
    },
    run({ doc }, cfg) {
      const el = doc.$("head title, title").get(0) as Element | undefined;
      const t = el ? doc.$(el).text().replace(/\s+/g, " ").trim() : "";
      if (!el || !t) return fail("The page has no title", conf(cfg, "confidence_fail_1"), [{ claim: "No non-empty <title> element", value: null, locator: "head" }]);
      const ev = { claim: "Page title", value: t, locator: pathOf(el) };
      if (/^(home|homepage|index|untitled|untitled document|new page|my site|wordpress)$/i.test(t)) {
        return fail(`The title is a placeholder ("${t}")`, conf(cfg, "confidence_fail_2"), [ev], "low");
      }
      return pass("Page has a title", conf(cfg, "confidence_pass"), [ev]);
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
    confidences: {
      confidence_fail: { default: 0.95, min: 0.1, max: 1, description: "Confidence of the FAIL result \"No meta description\"" },
      confidence_pass: { default: 0.95, min: 0.1, max: 1, description: "Confidence of the PASS result \"Meta description present\"" },
    },
    run({ doc }, cfg) {
      const el = doc.$("meta[name='description' i]").get(0) as Element | undefined;
      const c = el ? (doc.$(el).attr("content") ?? "").trim() : "";
      if (!c) return fail("No meta description", conf(cfg, "confidence_fail"), [{ claim: "No non-empty <meta name=description>", value: null, locator: "head" }]);
      return pass("Meta description present", conf(cfg, "confidence_pass"), [{ claim: "Meta description", value: c, locator: pathOf(el as Element) }]);
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
    confidences: {
      confidence_fail_1: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the FAIL result \"No canonical link\"" },
      confidence_fail_2: { default: 0.85, min: 0.1, max: 1, description: "Confidence of the FAIL result \"Canonical points to another site (…)\"" },
      confidence_pass: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the PASS result \"Canonical link on the same site\"" },
    },
    run({ doc }, cfg) {
      const el = doc.$("link[rel~='canonical' i]").get(0) as Element | undefined;
      if (!el) return fail("No canonical link", conf(cfg, "confidence_fail_1"), [{ claim: "No <link rel=canonical>", value: null, locator: "head" }], "info");
      const href = doc.$(el).attr("href");
      const u = resolveHref(doc, href);
      const ev = { claim: "Canonical link", value: href ?? null, locator: pathOf(el) };
      if (!u) return indeterminate("Canonical link has no usable href", [ev]);
      if (!sameSite(u, doc.url)) return fail(`Canonical points to another site (${u.hostname})`, conf(cfg, "confidence_fail_2"), [ev]);
      return pass("Canonical link on the same site", conf(cfg, "confidence_pass"), [ev]);
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
    confidences: {
      confidence_fail_1: { default: 0.97, min: 0.1, max: 1, description: "Confidence of the FAIL result \"The homepage tells search engines not to index it\"" },
      confidence_fail_2: { default: 0.97, min: 0.1, max: 1, description: "Confidence of the FAIL result \"The homepage response tells search engines not to index it\"" },
      confidence_pass: { default: 0.95, min: 0.1, max: 1, description: "Confidence of the PASS result \"No noindex directive found\"" },
    },
    run(ctx, cfg) {
      const { doc } = ctx;
      const metas = doc.$("meta[name='robots' i], meta[name='googlebot' i]").toArray() as Element[];
      for (const el of metas) {
        const c = (doc.$(el).attr("content") ?? "").toLowerCase();
        if (/\b(noindex|none)\b/.test(c)) {
          return fail("The homepage tells search engines not to index it", conf(cfg, "confidence_fail_1"), [{ claim: "Robots meta tag", value: c, excerpt: excerptOf(doc.$, el), locator: pathOf(el) }]);
        }
      }
      const header = ctx.headers["x-robots-tag"];
      if (header && /\b(noindex|none)\b/i.test(header)) {
        return fail("The homepage response tells search engines not to index it", conf(cfg, "confidence_fail_2"), [{ claim: "X-Robots-Tag response header", value: header, locator: "response headers", sourceRecordId: ctx.pageSourceRecordId }]);
      }
      return pass("No noindex directive found", conf(cfg, "confidence_pass"));
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
    confidences: {
      confidence_pass: { default: 0.95, min: 0.1, max: 1, description: "Confidence of the PASS result \"Sitemap is reachable\"" },
      confidence_fail: { default: 0.6, min: 0.1, max: 1, description: "Confidence of the FAIL result \"No sitemap at the expected location\"" },
    },
    run(ctx, cfg) {
      const p = ctx.sitemap;
      if (!p) return indeterminate("No sitemap request was made");
      const ev = probeEvidence(p, "Result of requesting the sitemap");
      const xml = /xml|gzip/i.test(p.contentType ?? "");
      if (p.httpStatus === 200 && xml) return pass("Sitemap is reachable", conf(cfg, "confidence_pass"), [ev]);
      if (p.httpStatus === 404 || p.httpStatus === 410) return fail("No sitemap at the expected location", conf(cfg, "confidence_fail"), [ev]);
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
    confidences: {
      confidence_fail_1: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the FAIL result \"No h1 heading on the page\"" },
      confidence_fail_2: { default: 0.8, min: 0.1, max: 1, description: "Confidence of the FAIL result \"… h1 headings\"" },
      confidence_fail_3: { default: 0.7, min: 0.1, max: 1, description: "Confidence of the FAIL result \"Heading level skipped: …\"" },
      confidence_pass: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the PASS result \"One h1 and headings in order\"" },
    },
    run({ doc }, cfg) {
      const hs = visible(doc, "h1, h2, h3, h4, h5, h6");
      const h1 = hs.filter((h) => h.name === "h1");
      const ev = h1.map((h) => ({ claim: "h1 heading", value: textOf(doc.$, h), locator: pathOf(h) }));
      if (h1.length === 0) return fail("No h1 heading on the page", conf(cfg, "confidence_fail_1"), [{ claim: "No visible <h1>", value: null, locator: "body" }]);
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
      if (h1.length > 1) return fail(`${h1.length} h1 headings`, conf(cfg, "confidence_fail_2"), ev, "info");
      if (skip) return fail(`Heading level skipped: ${skip}`, conf(cfg, "confidence_fail_3"), [...ev, { claim: "Skipped heading level", value: skip, locator: "body" }], "info");
      return pass("One h1 and headings in order", conf(cfg, "confidence_pass"), ev);
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
    confidences: {
      confidence_fail: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the FAIL result \"… of … sampled internal links are broken\"" },
      confidence_pass: { default: 0.85, min: 0.1, max: 1, description: "Confidence of the PASS result \"… of … sampled internal links resolved\"" },
    },
    run(ctx, cfg) {
      if (ctx.links.length === 0) return notApplicable("No internal links were sampled");
      const broken = ctx.links.filter((p) => p.httpStatus === 404 || p.httpStatus === 410);
      const ok = ctx.links.filter((p) => p.outcome === "OK");
      const ev = ctx.links.map((p) => probeEvidence(p, "Sampled internal link"));
      if (broken.length) return fail(`${broken.length} of ${ctx.links.length} sampled internal links are broken`, conf(cfg, "confidence_fail"), ev);
      if (ok.length) return pass(`${ok.length} of ${ctx.links.length} sampled internal links resolved`, conf(cfg, "confidence_pass"), ev);
      return indeterminate("None of the sampled links could be checked", ev);
    },
  },
];
