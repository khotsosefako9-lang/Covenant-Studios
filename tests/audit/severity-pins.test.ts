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
};

describe("check set regression pins", () => {
  it("has exactly the pinned checks at the pinned severities", () => {
    expect(Object.fromEntries(ALL_CHECKS.map((c) => [c.key, c.severity]))).toEqual(PINNED);
  });

  it("is check set version m0.1 (bump the version when check logic changes)", () => {
    expect(CHECK_SET_VERSION).toBe("m0.1");
  });
});
