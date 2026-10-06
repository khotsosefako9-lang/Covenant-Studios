// The control set: well-built sites where the correct result is silence. A false finding
// here would reach a human as fact, so the bar is stricter than "no high severity":
// no FAIL at low severity or above, and every info-level observation is listed explicitly.
import { describe, expect, it } from "vitest";
import { SEVERITY_RANK } from "@/audit/types";
import { triage } from "@/audit/shell";
import { ctxFor, fixture, run } from "./helpers";

// Capacity results (Phase 9). Controls firing here is expected and correct: these record
// operating scale, not weakness. Pinned so that any change in what they fire on is reviewed.
// Commercial-offer results (Phase 10): only the rugby union offers sponsorship for sale.
const NO_OFFERS = { "commercial.sponsorship_offer": "ABSENT", "commercial.procurement_portal": "ABSENT" };

const ABSENT_ALL = {
  "capacity.careers_page": "ABSENT",
  "capacity.multiple_locations": "INDETERMINATE",
  "capacity.online_shop": "ABSENT",
  "capacity.client_logo_wall": "ABSENT",
  "capacity.sponsor_section": "ABSENT",
  "capacity.accreditation": "ABSENT",
};

const CONTROLS = [
  {
    file: "plumber.html",
    url: "https://bayplumbing.co.za/",
    name: "Bay Plumbing",
    info: [] as string[],
    // One PostalAddress in JSON-LD: not evidence of one location (Phase 11). "Certified
    // installations with a certificate of compliance" names no body: uncertain, not absent.
    capacity: { ...ABSENT_ALL, "capacity.accreditation": "INDETERMINATE" },
  },
  {
    file: "industrial.html",
    url: "https://ecsafety.co.za/",
    name: "EC Safety Supply",
    info: ["conv.whatsapp_link", "conv.pricing_info"],
    // Phase 11: two client logos under "Trusted by" are evidence of operating scale.
    // "SABS-approved" and "certified" name no body: uncertain, not absent.
    capacity: { ...ABSENT_ALL, "capacity.client_logo_wall": "PRESENT", "capacity.accreditation": "INDETERMINATE" },
  },
  {
    file: "rugby.html",
    url: "https://ecrugby.co.za/",
    name: "Eastern Cape Rugby Union",
    info: ["conv.whatsapp_link"],
    // An "Our sponsors" heading and a /sponsors/ link, but no sponsor named on the page.
    capacity: { ...ABSENT_ALL, "capacity.sponsor_section": "INDETERMINATE" },
    // "Sponsorship packages" (a link and the text beside it): commercial inventory for sale.
    offers: { ...NO_OFFERS, "commercial.sponsorship_offer": "PRESENT" },
  },
  {
    file: "lawfirm.html",
    url: "https://mbekipartners.co.za/",
    name: "Mbeki & Partners",
    info: ["conv.whatsapp_link", "conv.pricing_info", "content.social_links"],
    // "members of the Legal Practice Council". The firm's own name ("& Partners") is not a partner section.
    capacity: { ...ABSENT_ALL, "capacity.accreditation": "PRESENT" },
  },
  {
    file: "nextjs-ssr.html",
    url: "https://karooleather.co.za/",
    name: "Karoo Leather Goods",
    info: [],
    // A /shop link, not read; no cart on the homepage.
    capacity: { ...ABSENT_ALL, "capacity.online_shop": "INDETERMINATE" },
  },
  { file: "wordpress.html", url: "https://reelcoast.co.za/", name: "Reel Coast Studios", info: ["conv.whatsapp_link"], capacity: ABSENT_ALL },
];

describe.each(CONTROLS.map((c) => ({ offers: NO_OFFERS, ...c })))("control: $file", ({ file, url, name, info, capacity, offers }) => {
  const html = fixture(`controls/${file}`);
  const results = run(html, { url, companyName: name });

  it("is auditable (not mistaken for a shell or an empty page)", () => {
    expect(triage(ctxFor(html, { url }).doc).kind).toBe("auditable");
  });

  it("raises no finding at low severity or above", () => {
    const loud = results
      .filter((r) => r.result.status === "FAIL" && r.severity && SEVERITY_RANK[r.severity] >= SEVERITY_RANK.low)
      .map((r) => `${r.check.key} (${r.severity}): ${r.result.detail}`);
    expect(loud).toEqual([]);
  });

  it("raises no high-severity finding", () => {
    expect(results.filter((r) => r.result.status === "FAIL" && r.severity === "high")).toEqual([]);
  });

  it("raises only the expected info-level observations", () => {
    const observed = results.filter((r) => r.result.status === "FAIL").map((r) => r.check.key).sort();
    expect(observed).toEqual([...info].sort());
  });

  it("records exactly the pinned capacity results, none of them a FAIL", () => {
    const observed = Object.fromEntries(results.filter((r) => r.check.category === "capacity").map((r) => [r.check.key, r.result.status]));
    expect(observed).toEqual(capacity);
  });

  it("records exactly the pinned commercial-offer results", () => {
    const observed = Object.fromEntries(results.filter((r) => r.check.category === "commercial").map((r) => [r.check.key, r.result.status]));
    expect(observed).toEqual(offers);
  });

  it("has no check errors", () => {
    expect(results.filter((r) => r.result.status === "ERROR")).toEqual([]);
  });

  it("passes the core checks a well-built site must pass", () => {
    const passed = new Set(results.filter((r) => r.result.status === "PASS").map((r) => r.check.key));
    for (const key of [
      "tech.https",
      "tech.certificate_valid",
      "tech.http_redirects_to_https",
      "tech.viewport_meta",
      "tech.title",
      "tech.meta_description",
      "tech.indexable",
      "conv.contact_path",
      "conv.primary_cta_first_screen",
      "content.business_identity",
      "content.location_stated",
    ]) {
      expect(passed, key).toContain(key);
    }
  });
});
