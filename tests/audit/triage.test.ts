// Whole-page triage: shells, empty pages and hostile markup must produce no findings.
import { describe, expect, it } from "vitest";
import { triage } from "@/audit/shell";
import { ctxFor, fixture, run, statusOf } from "./helpers";

const kind = (path: string) => triage(ctxFor(fixture(path)).doc).kind;

describe("JavaScript shells are RENDER_REQUIRED", () => {
  it.each(["special/shell-react.html", "special/shell-angular.html", "special/shell-vue-loading.html"])("%s", (path) => {
    const t = triage(ctxFor(fixture(path)).doc);
    expect(t.kind).toBe("render_required");
    if (t.kind !== "auditable") expect(t.reasons.length).toBeGreaterThan(0);
  });

  it("does not mistake a server-rendered Next.js page with a large data blob for a shell", () => {
    const t = triage(ctxFor(fixture("controls/nextjs-ssr.html")).doc);
    expect(t.kind).toBe("auditable");
    expect(t.metrics.frameworkRoot).toBe("#__next");
    expect(t.metrics.frameworkRootEmpty).toBe(false);
  });

  it("names the evidence it used", () => {
    const t = triage(ctxFor(fixture("special/shell-react.html")).doc);
    expect(t.metrics).toMatchObject({ frameworkRoot: "#root", frameworkRootEmpty: true, noscriptAsksForJs: true, visibleTextChars: 0 });
  });
});

describe("pages with nothing to audit are NO_CONTENT", () => {
  it.each([
    ["special/empty.html", /0 characters/],
    ["special/svg-only.html", /0 characters/],
    ["special/meta-refresh.html", /meta http-equiv=refresh/],
    // An unclosed <title> swallows the whole document as title text, as browsers do: the page renders blank.
    ["special/malformed.html", /0 characters/],
  ])("%s", (path, reason) => {
    const t = triage(ctxFor(fixture(path)).doc);
    expect(t.kind).toBe("no_content");
    if (t.kind !== "auditable") expect(t.reasons.join(" ")).toMatch(reason);
  });
});

describe("hostile but auditable markup", () => {
  it("parses sloppy HTML (unclosed p/li/td, no head, unquoted attributes) correctly", () => {
    const html = fixture("special/malformed-tolerable.html");
    expect(kind("special/malformed-tolerable.html")).toBe("auditable");
    const r = run(html, { companyName: "Kragga Kamma Nursery" });
    expect(statusOf(r, "tech.title")).toBe("PASS");
    expect(statusOf(r, "tech.viewport_meta")).toBe("PASS");
    expect(statusOf(r, "conv.contact_path")).toBe("PASS");
    expect(statusOf(r, "conv.click_to_call")).toBe("PASS");
    expect(statusOf(r, "conv.enquiry_form")).toBe("PASS");
    expect(statusOf(r, "content.business_identity")).toBe("PASS");
    expect(r.filter((x) => x.result.status === "ERROR")).toEqual([]);
  });

  it("handles a very long page (about 3.4 MB, 2,000 sections) quickly and without errors", () => {
    const section = (i: number) =>
      `<section><h2>Product line ${i}</h2><p>${"Industrial fittings and couplings for process plants. ".repeat(30)}</p><a href="/p/${i}">Details</a></section>`;
    const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Huge Catalogue Co</title></head><body><h1>Huge Catalogue Co</h1><a href="/contact">Contact us</a>${Array.from({ length: 2000 }, (_, i) => section(i)).join("")}<p>© 2026 Huge Catalogue Co</p></body></html>`;
    expect(html.length).toBeGreaterThan(3_000_000);
    const started = performance.now();
    const r = run(html);
    expect(performance.now() - started).toBeLessThan(15_000);
    expect(r.filter((x) => x.result.status === "ERROR")).toEqual([]);
    expect(statusOf(r, "tech.html_weight")).toBe("FAIL");
    expect(statusOf(r, "tech.broken_internal_links")).toBe("PASS"); // only 5 links sampled
  });
});

describe("non-English pages", () => {
  it("abstains on every wording-based check but still judges structure", () => {
    const html = fixture("special/afrikaans.html");
    const ctx = ctxFor(html, { url: "https://vdmbouers.co.za/" });
    expect(ctx.doc.vocabularyReliable).toBe(false);
    const r = run(html, { url: "https://vdmbouers.co.za/" });
    for (const key of ["conv.trust_signals", "conv.services_named", "conv.pricing_info"]) expect(statusOf(r, key)).toBe("INDETERMINATE");
    expect(statusOf(r, "conv.primary_cta_first_screen")).toBe("INDETERMINATE");
    // Language-neutral: a contact page link ("Kontak ons") and a number that cannot be tapped.
    expect(statusOf(r, "conv.contact_path")).toBe("PASS");
    expect(statusOf(r, "conv.click_to_call")).toBe("FAIL");
    expect(statusOf(r, "tech.viewport_meta")).toBe("PASS");
  });
});
