// Per-check fixtures: every check, every status it can produce, and the evidence it cites.
import { describe, expect, it } from "vitest";
import { ALL_CHECKS, evaluate } from "@/audit/registry";
import type { AuditContext } from "@/audit/types";
import { ctxFor, probe } from "./helpers";

const FILLER = "<p>We are a family business and we work with you on every job, with clear quotes and friendly service for our customers.</p>";

function page(body: string, head = "", lang = "en") {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">${head}</head><body>${body}${FILLER}</body></html>`;
}

function check(key: string, html: string, over: Partial<AuditContext> & { url?: string } = {}) {
  const def = ALL_CHECKS.find((c) => c.key === key);
  if (!def) throw new Error(`unknown check ${key}`);
  const [r] = evaluate(ctxFor(html, over), new Set([key]));
  if (!r) throw new Error("no result");
  return { status: r.result.status, severity: r.severity, detail: r.result.detail, evidence: "evidence" in r.result ? r.result.evidence : [], confidence: r.result.confidence };
}

describe("registry", () => {
  it("has 30 uniquely keyed checks, each documented", () => {
    expect(ALL_CHECKS).toHaveLength(30);
    expect(new Set(ALL_CHECKS.map((c) => c.key)).size).toBe(30);
    for (const c of ALL_CHECKS) {
      expect(c.description.length, c.key).toBeGreaterThan(20);
      expect(c.evidenceRecorded.length, c.key).toBeGreaterThan(10);
    }
  });

  it("runs only enabled checks", () => {
    expect(evaluate(ctxFor(page("<h1>x</h1>")), new Set(["tech.title"])).map((r) => r.check.key)).toEqual(["tech.title"]);
  });

  it("turns a throwing check into ERROR without stopping the others", () => {
    const ctx = ctxFor(page("<h1>x</h1>"));
    const broken = { ...ctx, get https(): never { throw new Error("boom"); } } as unknown as AuditContext;
    const results = evaluate(broken);
    expect(results.find((r) => r.check.key === "tech.https")?.result.status).toBe("ERROR");
    expect(results.find((r) => r.check.key === "tech.title")?.result.status).not.toBe("ERROR");
  });
});

describe("technical", () => {
  it("tech.https", () => {
    expect(check("tech.https", page("")).status).toBe("PASS");
    const httpOnly = check("tech.https", page(""), { url: "http://example.co.za/", https: { outcome: "UNREACHABLE", detail: "ECONNREFUSED", sourceRecordId: null } });
    expect(httpOnly).toMatchObject({ status: "FAIL", severity: "high" });
    expect(check("tech.https", page(""), { https: { outcome: "TLS_ERROR", detail: "x", sourceRecordId: null } }).status).toBe("NOT_APPLICABLE");
    expect(check("tech.https", page(""), { https: { outcome: "TIMEOUT", detail: null, sourceRecordId: null } }).status).toBe("INDETERMINATE");
  });

  it("tech.certificate_valid fails only on errors browsers also reject", () => {
    const tls = (detail: string) => check("tech.certificate_valid", page(""), { https: { outcome: "TLS_ERROR", detail, sourceRecordId: null } });
    expect(tls("CERT_HAS_EXPIRED: certificate has expired")).toMatchObject({ status: "FAIL", severity: "high" });
    expect(tls("ERR_TLS_CERT_ALTNAME_INVALID: Hostname/IP does not match").status).toBe("FAIL");
    expect(tls("DEPTH_ZERO_SELF_SIGNED_CERT: self-signed certificate").status).toBe("FAIL");
    expect(tls("UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate").status).toBe("INDETERMINATE");
    expect(check("tech.certificate_valid", page("")).status).toBe("PASS");
  });

  it("tech.http_redirects_to_https", () => {
    expect(check("tech.http_redirects_to_https", page("")).status).toBe("PASS");
    const noRedirect = probe("http://example.co.za/", { finalUrl: "http://example.co.za/" });
    expect(check("tech.http_redirects_to_https", page(""), { httpVariant: noRedirect })).toMatchObject({ status: "FAIL", severity: "medium" });
    expect(check("tech.http_redirects_to_https", page(""), { httpVariant: probe("http://x/", { outcome: "TIMEOUT", httpStatus: null }) }).status).toBe("INDETERMINATE");
    expect(check("tech.http_redirects_to_https", page(""), { https: { outcome: "UNREACHABLE", detail: null, sourceRecordId: null } }).status).toBe("NOT_APPLICABLE");
    expect(check("tech.http_redirects_to_https", page(""), { https: null }).status).toBe("INDETERMINATE");
  });

  it("tech.viewport_meta", () => {
    expect(check("tech.viewport_meta", page("", '<meta name="viewport" content="width=device-width, initial-scale=1">')).status).toBe("PASS");
    const missing = check("tech.viewport_meta", page(""));
    expect(missing).toMatchObject({ status: "FAIL", severity: "medium" });
    expect(missing.evidence[0]?.locator).toBe("head");
    const fixed = check("tech.viewport_meta", page("", '<meta name="viewport" content="width=1024">'));
    expect(fixed.status).toBe("FAIL");
    expect(fixed.evidence[0]?.value).toBe("width=1024");
  });

  it("tech.html_weight measures the HTML alone and records referenced resources", () => {
    const small = check("tech.html_weight", page('<img src="a.png"><script src="a.js"></script>'));
    expect(small.status).toBe("PASS");
    expect(small.evidence[0]?.excerpt).toContain("1 scripts");
    expect(check("tech.html_weight", page(`<p>${"x".repeat(1_100_000)}</p>`))).toMatchObject({ status: "FAIL", severity: "low" });
  });

  it("tech.response_time is one measurement, judged cautiously", () => {
    expect(check("tech.response_time", page(""), { responseMs: 800 }).status).toBe("PASS");
    const slow = check("tech.response_time", page(""), { responseMs: 4200 });
    expect(slow).toMatchObject({ status: "FAIL", severity: "low" });
    expect(slow.confidence).toBeLessThanOrEqual(0.5);
    expect(check("tech.response_time", page(""), { responseMs: null }).status).toBe("INDETERMINATE");
  });

  it("tech.title", () => {
    expect(check("tech.title", page("", "<title>Bay Plumbing | Gqeberha</title>")).status).toBe("PASS");
    expect(check("tech.title", page(""))).toMatchObject({ status: "FAIL", severity: "medium" });
    expect(check("tech.title", page("", "<title>  </title>")).status).toBe("FAIL");
    expect(check("tech.title", page("", "<title>Home</title>"))).toMatchObject({ status: "FAIL", severity: "low" });
  });

  it("tech.meta_description", () => {
    expect(check("tech.meta_description", page("", '<meta name="description" content="Plumbers in Gqeberha">')).status).toBe("PASS");
    expect(check("tech.meta_description", page("", '<meta name="description" content="">'))).toMatchObject({ status: "FAIL", severity: "low" });
  });

  it("tech.canonical", () => {
    expect(check("tech.canonical", page("", '<link rel="canonical" href="https://www.example.co.za/">')).status).toBe("PASS");
    expect(check("tech.canonical", page(""))).toMatchObject({ status: "FAIL", severity: "info" });
    expect(check("tech.canonical", page("", '<link rel="canonical" href="https://other.co.za/">'))).toMatchObject({ status: "FAIL", severity: "low" });
  });

  it("tech.indexable", () => {
    expect(check("tech.indexable", page("")).status).toBe("PASS");
    const noindex = check("tech.indexable", page("", '<meta name="robots" content="noindex, follow">'));
    expect(noindex).toMatchObject({ status: "FAIL", severity: "high" });
    expect(noindex.evidence[0]?.locator).toContain("meta");
    expect(check("tech.indexable", page("", '<meta name="robots" content="none">')).status).toBe("FAIL");
    expect(check("tech.indexable", page(""), { headers: { "x-robots-tag": "noindex" } }).status).toBe("FAIL");
    expect(check("tech.indexable", page("", '<meta name="robots" content="index, follow">')).status).toBe("PASS");
  });

  it("tech.sitemap", () => {
    expect(check("tech.sitemap", page("")).status).toBe("PASS");
    expect(check("tech.sitemap", page(""), { sitemap: probe("https://x/sitemap.xml", { outcome: "HTTP_ERROR", httpStatus: 404 }) })).toMatchObject({ status: "FAIL", severity: "info" });
    expect(check("tech.sitemap", page(""), { sitemap: probe("https://x/sitemap.xml", { contentType: "text/html" }) }).status).toBe("INDETERMINATE");
    expect(check("tech.sitemap", page(""), { sitemap: probe("https://x/sitemap.xml", { outcome: "SOURCE_BLOCKED", httpStatus: null }) }).status).toBe("INDETERMINATE");
  });

  it("tech.headings", () => {
    expect(check("tech.headings", page("<h1>A</h1><h2>B</h2><h3>C</h3>")).status).toBe("PASS");
    expect(check("tech.headings", page("<h2>B</h2>"))).toMatchObject({ status: "FAIL", severity: "low" });
    expect(check("tech.headings", page("<h1>A</h1><h1>B</h1>"))).toMatchObject({ status: "FAIL", severity: "info" });
    const skipped = check("tech.headings", page("<h1>A</h1><h4>D</h4>"));
    expect(skipped).toMatchObject({ status: "FAIL", severity: "info" });
    expect(skipped.detail).toContain("h1 followed by h4");
    expect(check("tech.headings", page('<h1 hidden>A</h1><h2>B</h2>')).status).toBe("FAIL");
  });

  it("tech.broken_internal_links samples five links and fails only on 404/410", () => {
    const links = Array.from({ length: 8 }, (_, i) => `<a href="/p${i}">Page ${i}</a>`).join("");
    const ok = check("tech.broken_internal_links", page(links));
    expect(ok.status).toBe("PASS");
    expect(ok.evidence).toHaveLength(5);
    const ctx = { links: [probe("https://example.co.za/p0"), probe("https://example.co.za/p1", { outcome: "HTTP_ERROR", httpStatus: 404 })] };
    expect(check("tech.broken_internal_links", page(links), ctx)).toMatchObject({ status: "FAIL", severity: "medium" });
    expect(check("tech.broken_internal_links", page(links), { links: [probe("https://example.co.za/p0", { outcome: "HTTP_ERROR", httpStatus: 503 })] }).status).toBe("INDETERMINATE");
    expect(check("tech.broken_internal_links", page('<a href="https://other.co.za/">x</a>')).status).toBe("NOT_APPLICABLE");
  });
});

describe("conversion", () => {
  it("conv.primary_cta_first_screen", () => {
    const hero = check("conv.primary_cta_first_screen", page('<h1>Plumbers</h1><a class="btn" href="/quote">Get a free quote</a>'));
    expect(hero.status).toBe("PASS");
    expect(hero.evidence[0]?.locator).toMatch(/a.*text offset/);
    const late = check("conv.primary_cta_first_screen", page(`<h1>Plumbers</h1><p>${"Long introduction text. ".repeat(80)}</p><a href="/quote">Request a quote</a>`));
    expect(late).toMatchObject({ status: "FAIL", severity: "medium" });
    expect(late.detail).toContain("characters into the page");
    expect(check("conv.primary_cta_first_screen", page("<h1>Plumbers</h1><p>We fix pipes.</p>")).status).toBe("FAIL");
    expect(check("conv.primary_cta_first_screen", page('<h1>Plumbers</h1><a href="tel:+27415550101">041 555 0101</a>')).status).toBe("PASS");
  });

  it("conv.primary_cta_first_screen ignores long navigation menus when measuring the first screen", () => {
    const menu = `<nav>${Array.from({ length: 80 }, (_, i) => `<a href="/m${i}">Menu item number ${i}</a>`).join("")}</nav>`;
    expect(check("conv.primary_cta_first_screen", page(`${menu}<h1>Welcome</h1><a href="/book">Book now</a>`)).status).toBe("PASS");
  });

  it("conv.primary_cta_first_screen ignores hidden elements", () => {
    expect(check("conv.primary_cta_first_screen", page('<h1>Hi</h1><a href="/quote" style="display:none">Get a quote</a>')).status).toBe("FAIL");
  });

  it("conv.contact_path", () => {
    for (const body of [
      '<a href="tel:+27415550101">Call</a>',
      '<a href="mailto:a@b.co.za">Email</a>',
      '<a href="https://wa.me/27820000000">Chat</a>',
      '<form><input name="name"><textarea name="msg"></textarea></form>',
      '<iframe src="https://docs.google.com/forms/d/e/abc/viewform"></iframe>',
      "<p>Phone 041 555 0101</p>",
      "<p>info@example.co.za</p>",
      '<a href="/contact-us">Get in touch</a>',
    ]) {
      expect(check("conv.contact_path", page(body)).status, body).toBe("PASS");
    }
    const none = check("conv.contact_path", page("<h1>About us</h1>"));
    expect(none).toMatchObject({ status: "FAIL", severity: "high" });
    // A search box and a newsletter field are not contact paths.
    expect(check("conv.contact_path", page('<form role="search"><input type="search" name="q"></form><form><input type="email" name="email"></form>')).status).toBe("FAIL");
    expect(check("conv.contact_path", page("<h1>Oor ons</h1>", "", "af")).status).toBe("INDETERMINATE");
  });

  it("conv.click_to_call", () => {
    expect(check("conv.click_to_call", page('<a href="tel:0415550101">041 555 0101</a>')).status).toBe("PASS");
    const plain = check("conv.click_to_call", page("<p>Call us on 041 555 0101</p>"));
    expect(plain).toMatchObject({ status: "FAIL", severity: "medium" });
    expect(plain.evidence[0]?.value).toBe("041 555 0101");
    expect(check("conv.click_to_call", page('<p>WhatsApp <a href="https://wa.me/27825550199">082 555 0199</a></p>')).status).toBe("PASS");
    expect(check("conv.click_to_call", page("<p>No phone here</p>")).status).toBe("NOT_APPLICABLE");
  });

  it("conv.whatsapp_link", () => {
    expect(check("conv.whatsapp_link", page('<a href="https://api.whatsapp.com/send?phone=27820000000">WA</a>')).status).toBe("PASS");
    expect(check("conv.whatsapp_link", page('<a href="whatsapp://send?phone=27820000000">WA</a>')).status).toBe("PASS");
    expect(check("conv.whatsapp_link", page(""))).toMatchObject({ status: "FAIL", severity: "info" });
  });

  it("conv.enquiry_form", () => {
    expect(check("conv.enquiry_form", page('<form><input name="name"><textarea name="m"></textarea><button>Send</button></form>')).status).toBe("PASS");
    expect(check("conv.enquiry_form", page('<iframe src="https://form.typeform.com/to/abc"></iframe>')).status).toBe("PASS");
    expect(check("conv.enquiry_form", page('<script src="https://js.hsforms.net/forms/v2.js"></script>')).status).toBe("INDETERMINATE");
    expect(check("conv.enquiry_form", page('<a href="/contact">Contact</a>')).status).toBe("INDETERMINATE");
    expect(check("conv.enquiry_form", page('<form role="search"><input type="search" name="q"></form>'))).toMatchObject({ status: "FAIL", severity: "low" });
    expect(check("conv.enquiry_form", page('<form><input type="email" name="email"><button>Subscribe</button></form>')).status).toBe("FAIL");
    expect(check("conv.enquiry_form", page('<form><input name="user"><input type="password" name="pw"></form>')).status).toBe("FAIL");
  });

  it("conv.form_required_fields", () => {
    const fields = (n: number) => Array.from({ length: n }, (_, i) => `<input name="f${i}" required>`).join("");
    expect(check("conv.form_required_fields", page(`<form>${fields(4)}<textarea name="m"></textarea></form>`)).status).toBe("PASS");
    const many = check("conv.form_required_fields", page(`<form>${fields(7)}<textarea name="m"></textarea></form>`));
    expect(many).toMatchObject({ status: "FAIL", severity: "medium" });
    expect(many.evidence[0]?.value).toBe("7");
    expect(check("conv.form_required_fields", page('<form><input aria-required="true" name="a"><input type="hidden" name="h" required></form>')).evidence[0]?.value).toBe("1");
    expect(check("conv.form_required_fields", page("")).status).toBe("NOT_APPLICABLE");
    expect(check("conv.form_required_fields", page('<iframe src="https://docs.google.com/forms/x"></iframe>')).status).toBe("INDETERMINATE");
  });

  it("conv.form_position", () => {
    const form = '<form><input name="n"><textarea name="m"></textarea></form>';
    expect(check("conv.form_position", page(`<h1>Hi</h1>${form}`)).status).toBe("PASS");
    const low = check("conv.form_position", page(`<h1>Hi</h1><p>${"Paragraph text here. ".repeat(200)}</p>${form}`));
    expect(low).toMatchObject({ status: "FAIL", severity: "low" });
    expect(low.confidence).toBeLessThanOrEqual(0.5);
    expect(check("conv.form_position", page("")).status).toBe("NOT_APPLICABLE");
  });

  it("conv.trust_signals", () => {
    for (const body of [
      "<h2>Testimonials</h2>",
      "<p>What our clients say</p>",
      "<p>Members of the Legal Practice Council</p>",
      "<p>Accreditation: ISO 9001 certified</p>",
      '<script type="application/ld+json">{"@type":"AggregateRating","ratingValue":4.8}</script>',
      '<iframe src="https://widget.trustpilot.com/x"></iframe>',
    ]) {
      expect(check("conv.trust_signals", page(body)).status, body).toBe("PASS");
    }
    expect(check("conv.trust_signals", page("<h1>Plumbing</h1>"))).toMatchObject({ status: "FAIL", severity: "low" });
    expect(check("conv.trust_signals", page("<h1>Loodgieters</h1>", "", "af")).status).toBe("INDETERMINATE");
  });

  it("conv.services_named fails only on thin pages", () => {
    expect(check("conv.services_named", page("<h2>Our services</h2>")).status).toBe("PASS");
    expect(check("conv.services_named", page("<p>We supply industrial fittings.</p>")).status).toBe("PASS");
    const thin = `<!doctype html><html lang="en"><body><h1>Welcome</h1><p>Welcome to the website.</p></body></html>`;
    expect(check("conv.services_named", thin)).toMatchObject({ status: "FAIL", severity: "low" });
    const rich = page(`<h1>Welcome</h1><h2>Matchday</h2><p>${"Supporters and members follow the season with us every week. ".repeat(20)}</p>`);
    expect(check("conv.services_named", rich).status).toBe("INDETERMINATE");
  });

  it("conv.pricing_info", () => {
    expect(check("conv.pricing_info", page("<p>Call-out from R450</p>")).status).toBe("PASS");
    expect(check("conv.pricing_info", page("<p>Packages from R 12 500 per season</p>")).status).toBe("PASS");
    expect(check("conv.pricing_info", page("<h2>Pricing</h2>")).status).toBe("PASS");
    expect(check("conv.pricing_info", page("<h1>Plumbing</h1>"))).toMatchObject({ status: "FAIL", severity: "info" });
  });
});

describe("content", () => {
  it("content.business_identity", () => {
    expect(check("content.business_identity", page("<h1>Bay Plumbing</h1>"), { companyName: "Bay Plumbing (Pty) Ltd" }).status).toBe("PASS");
    expect(check("content.business_identity", page("<h1>Welcome</h1>"), { companyName: "Bay Plumbing" }).status).toBe("INDETERMINATE");
    const bare = `<!doctype html><html lang="en"><body><p>${"Some words about things. ".repeat(10)}</p></body></html>`;
    expect(check("content.business_identity", bare, { companyName: "Bay Plumbing" })).toMatchObject({ status: "FAIL", severity: "low" });
  });

  it("content.location_stated", () => {
    for (const body of [
      "<p>Based in Gqeberha</p>",
      "<p>14 Cape Road, Newton Park</p>",
      "<address>Unit 4, Main Road</address>",
      '<a href="https://maps.google.com/?q=x">Map</a>',
      "<p>Service areas: all suburbs</p>",
      "<p>PO Box 1234</p>",
    ]) {
      expect(check("content.location_stated", page(body)).status, body).toBe("PASS");
    }
    expect(check("content.location_stated", page("<h1>Plumbing</h1>"))).toMatchObject({ status: "FAIL", severity: "low" });
  });

  it("content.copyright_year is judged against the retrieval date", () => {
    expect(check("content.copyright_year", page("<p>© 2026 Acme</p>")).status).toBe("PASS");
    expect(check("content.copyright_year", page("<p>© 2025 Acme</p>")).status).toBe("PASS");
    const old = check("content.copyright_year", page("<p>Copyright 2019 Acme</p>"));
    expect(old).toMatchObject({ status: "FAIL", severity: "low" });
    expect(old.confidence).toBeLessThanOrEqual(0.5);
    expect(check("content.copyright_year", page("<p>© 2012-2026 Acme</p>")).status).toBe("PASS");
    expect(check("content.copyright_year", page("<p>© 2030 Acme</p>")).status).toBe("INDETERMINATE");
    expect(check("content.copyright_year", page("")).status).toBe("NOT_APPLICABLE");
  });

  it("content.latest_dated_content uses only machine-readable dates", () => {
    expect(check("content.latest_dated_content", page('<time datetime="2026-08-01">1 Aug</time>')).status).toBe("PASS");
    const stale = check("content.latest_dated_content", page('<time datetime="2022-03-01">March 2022</time>'));
    expect(stale).toMatchObject({ status: "FAIL", severity: "low" });
    expect(stale.evidence[0]?.value).toBe("2022-03-01");
    expect(check("content.latest_dated_content", page("", '<meta property="article:modified_time" content="2021-01-01T00:00:00Z">')).status).toBe("FAIL");
    // Prose dates are ignored: "established 1998" is history, not staleness.
    expect(check("content.latest_dated_content", page("<p>Established in 1998. Updated 3 March 2019.</p>")).status).toBe("NOT_APPLICABLE");
  });

  it("content.heavy_catalogue reads declared sizes without downloading", () => {
    const html = page('<a href="/files/catalogue.pdf">Product catalogue</a>');
    expect(check("content.heavy_catalogue", html).status).toBe("PASS");
    const heavy = check("content.heavy_catalogue", html, {
      pdfs: [probe("https://example.co.za/files/catalogue.pdf", { outcome: "UNSUPPORTED_CONTENT_TYPE", contentType: "application/pdf", declaredLength: 48_000_000 })],
    });
    expect(heavy).toMatchObject({ status: "FAIL", severity: "medium" });
    expect(heavy.detail).toContain("45.8 MB");
    expect(check("content.heavy_catalogue", html, { pdfs: [probe("https://x/c.pdf", { declaredLength: null })] }).status).toBe("INDETERMINATE");
    expect(check("content.heavy_catalogue", page("")).status).toBe("NOT_APPLICABLE");
  });

  it("content.social_links ignores share buttons", () => {
    expect(check("content.social_links", page('<a href="https://www.instagram.com/acme">IG</a>')).status).toBe("PASS");
    expect(check("content.social_links", page('<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>'))).toMatchObject({ status: "FAIL", severity: "info" });
    expect(check("content.social_links", page('<a href="https://www.facebook.com/">Facebook</a>')).status).toBe("FAIL");
  });

  it("content.social_links_resolve treats platform refusals as indeterminate", () => {
    const html = page('<a href="https://www.facebook.com/acme">FB</a>');
    expect(check("content.social_links_resolve", html).status).toBe("INDETERMINATE");
    expect(check("content.social_links_resolve", html, { social: [probe("https://www.facebook.com/acme", { outcome: "HTTP_ERROR", httpStatus: 404 })] })).toMatchObject({ status: "FAIL", severity: "low" });
    expect(check("content.social_links_resolve", html, { social: [probe("https://www.facebook.com/acme")] }).status).toBe("PASS");
    expect(check("content.social_links_resolve", page("")).status).toBe("NOT_APPLICABLE");
  });
});
