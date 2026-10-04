// Standing regression guard: every check's FAIL severity is pinned here. Changing one is a
// deliberate edit to this file, reviewed alongside the control set, never a silent drift.
// Runs before every production build (see "prebuild" in package.json).
import { describe, expect, it } from "vitest";
import { ALL_CHECKS, CHECK_SET_VERSION } from "@/audit/registry";

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
};

describe("check set regression pins", () => {
  it("has exactly the pinned checks at the pinned severities", () => {
    expect(Object.fromEntries(ALL_CHECKS.map((c) => [c.key, c.severity]))).toEqual(PINNED);
  });

  it("is check set version m0.2 (bump the version when check logic changes)", () => {
    expect(CHECK_SET_VERSION).toBe("m0.2");
  });

  // Thresholds are configuration (audit_checks.params). Their code defaults are pinned here
  // too: a default that moves changes what the control set is tested against.
  it("has the pinned threshold defaults", () => {
    const defaults = Object.fromEntries(ALL_CHECKS.filter((c) => c.params).map((c) => [c.key, Object.fromEntries(Object.entries(c.params ?? {}).map(([k, v]) => [k, v.default]))]));
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
      "capacity.client_logo_wall": { min_logos: 4, max_text_chars_per_logo: 40 },
      "capacity.sponsor_section": { min_sponsors: 3, max_text_chars_per_logo: 40 },
    });
  });

  it("every default lies within the bounds an operator may set", () => {
    for (const c of ALL_CHECKS) for (const [k, v] of Object.entries(c.params ?? {})) expect(v.default >= v.min && v.default <= v.max, `${c.key}.${k}`).toBe(true);
  });
});
