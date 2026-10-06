// Standing regression guard: every check's FAIL severity is pinned here. Changing one is a
// deliberate edit to this file, reviewed alongside the control set, never a silent drift.
// Runs before every production build (see "prebuild" in package.json).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_CHECKS, CHECK_SET_VERSION, paramSpecsOf } from "@/audit/registry";

const PINNED: Record<string, string> = {
  "tech.https": "high",
  "tech.certificate_valid": "high",
  "tech.http_redirects_to_https": "medium",
  "tech.viewport_meta": "medium",
  "tech.html_weight": "low",
  "tech.response_time": "low",
  "tech.title": "medium",
  "tech.meta_description": "low",
  "tech.canonical": "low",
  "tech.indexable": "high",
  "tech.sitemap": "info",
  "tech.headings": "low",
  "tech.broken_internal_links": "medium",
  "conv.primary_cta_first_screen": "medium",
  "conv.contact_path": "high",
  "conv.click_to_call": "medium",
  "conv.whatsapp_link": "info",
  "conv.enquiry_form": "low",
  "conv.form_required_fields": "medium",
  "conv.form_position": "low",
  "conv.trust_signals": "low",
  "conv.services_named": "low",
  "conv.pricing_info": "info",
  "content.business_identity": "low",
  "content.location_stated": "low",
  "content.copyright_year": "low",
  "content.latest_dated_content": "low",
  "content.heavy_catalogue": "medium",
  "content.social_links": "info",
  "content.social_links_resolve": "low",
  // Capacity checks never FAIL; their nominal severity is info.
  "capacity.careers_page": "info",
  "capacity.multiple_locations": "info",
  "capacity.online_shop": "info",
  "capacity.client_logo_wall": "info",
  "capacity.sponsor_section": "info",
  "capacity.accreditation": "info",
  // Commercial-offer checks (Phase 10) never FAIL either.
  "commercial.sponsorship_offer": "info",
  "commercial.procurement_portal": "info",
};

describe("check set regression pins", () => {
  it("has exactly the pinned checks at the pinned severities", () => {
    expect(Object.fromEntries(ALL_CHECKS.map((c) => [c.key, c.severity]))).toEqual(PINNED);
  });

  it("is check set version m0.4 (bump the version when check logic changes)", () => {
    expect(CHECK_SET_VERSION).toBe("m0.4");
  });

  // Thresholds are configuration (audit_checks.params). Their code defaults are pinned here
  // too: a default that moves changes what the control set is tested against.
  it("has the pinned threshold defaults", () => {
    const defaults = Object.fromEntries(ALL_CHECKS.filter((c) => c.params).map((c) => [c.key, Object.fromEntries(Object.entries(c.params ?? {}).map(([k, v]) => [k, v.default]))]));
    expect(ALL_CHECKS.flatMap((c) => Object.keys(c.params ?? {})).filter((k) => k.startsWith("confidence_"))).toEqual([]);
    expect(defaults).toEqual({
      "tech.html_weight": { max_html_bytes: 1_000_000 },
      "tech.response_time": { max_response_ms: 3000 },
      "conv.primary_cta_first_screen": { first_screen_chars: 700 },
      "conv.form_required_fields": { max_required_fields: 6 },
      "conv.form_position": { max_offset_chars: 2500 },
      "content.copyright_year": { min_lag_years: 2 },
      "content.latest_dated_content": { max_age_months: 24 },
      "content.heavy_catalogue": { max_pdf_bytes: 10 * 1024 * 1024 },
      "capacity.multiple_locations": { min_distinct_locations: 2 },
      "capacity.client_logo_wall": { min_logos: 2, min_unlabelled_logos: 4, max_text_chars_per_logo: 40 },
      "capacity.sponsor_section": { min_sponsors: 2, min_unlabelled_logos: 4, max_text_chars_per_logo: 40 },
    });
  });

  it("every default lies within the bounds an operator may set", () => {
    for (const c of ALL_CHECKS) for (const [k, v] of Object.entries(paramSpecsOf(c))) expect(v.default >= v.min && v.default <= v.max, `${c.key}.${k}`).toBe(true);
  });

  // Each check's confidence in each of its outcomes is configuration too (Phase 10). The
  // defaults are pinned in a reviewed file: changing one is a deliberate edit, like a severity.
  it("has the pinned confidence defaults", () => {
    const actual = Object.fromEntries(
      ALL_CHECKS.filter((c) => c.confidences).map((c) => [c.key, Object.fromEntries(Object.entries(c.confidences ?? {}).map(([k, v]) => [k, v.default]))]),
    );
    expect(actual).toEqual(JSON.parse(readFileSync(join(__dirname, "confidence-pins.json"), "utf8")));
  });

  it("every check that judges something declares its confidences", () => {
    expect(ALL_CHECKS.filter((c) => !c.confidences || !Object.keys(c.confidences).length).map((c) => c.key)).toEqual([]);
  });
});

describe("confidences are configuration", () => {
  it("a stored confidence is the one the result carries, and an out-of-bounds one is refused", async () => {
    const { ctxFor } = await import("./helpers");
    const { evaluate, resolveCheckParams } = await import("@/audit/registry");
    const html = "<!doctype html><html lang='en'><head><title>x</title></head><body><h1>x</h1></body></html>";
    const [byDefault] = evaluate(ctxFor(html), new Set(["tech.viewport_meta"]));
    expect(byDefault?.result).toMatchObject({ status: "FAIL", confidence: 0.95 });
    const params = resolveCheckParams({ "tech.viewport_meta": { confidence_fail_1: 0.7 } });
    const [configured] = evaluate(ctxFor(html), new Set(["tech.viewport_meta"]), params);
    expect(configured?.result).toMatchObject({ status: "FAIL", confidence: 0.7 });
    expect(() => resolveCheckParams({ "tech.viewport_meta": { confidence_fail_1: 0 } })).toThrow(/tech.viewport_meta/);
  });
});
