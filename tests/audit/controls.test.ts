// The control set: well-built sites where the correct result is silence. A false finding
// here would reach a human as fact, so the bar is stricter than "no high severity":
// no FAIL at low severity or above, and every info-level observation is listed explicitly.
import { describe, expect, it } from "vitest";
import { SEVERITY_RANK } from "@/audit/types";
import { triage } from "@/audit/shell";
import { ctxFor, fixture, run } from "./helpers";

const CONTROLS = [
  { file: "plumber.html", url: "https://bayplumbing.co.za/", name: "Bay Plumbing", info: [] as string[] },
  { file: "industrial.html", url: "https://ecsafety.co.za/", name: "EC Safety Supply", info: ["conv.whatsapp_link", "conv.pricing_info"] },
  { file: "rugby.html", url: "https://ecrugby.co.za/", name: "Eastern Cape Rugby Union", info: ["conv.whatsapp_link"] },
  { file: "lawfirm.html", url: "https://mbekipartners.co.za/", name: "Mbeki & Partners", info: ["conv.whatsapp_link", "conv.pricing_info", "content.social_links"] },
  { file: "nextjs-ssr.html", url: "https://karooleather.co.za/", name: "Karoo Leather Goods", info: [] },
  { file: "wordpress.html", url: "https://reelcoast.co.za/", name: "Reel Coast Studios", info: ["conv.whatsapp_link"] },
];

describe.each(CONTROLS)("control: $file", ({ file, url, name, info }) => {
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
