// Capacity checks: structural markers of operating scale. The hard cases are the ones that
// look alike in markup (sponsor walls, client walls, partner walls, galleries); where the
// page does not say whose logos they are, the answer is INDETERMINATE.
import { describe, expect, it } from "vitest";
import { ALL_CHECKS, evaluate } from "@/audit/registry";
import type { CheckDefinition } from "@/audit/types";
import { ctxFor } from "./helpers";

const page = (body: string, head = "") =>
  `<!doctype html><html lang="en"><head><title>Acme Industrial Supplies</title>${head}</head><body><header><a href="/">Acme</a><nav><a href="/about">About us</a><a href="/contact">Contact us</a></nav></header><main><h1>Industrial supplies for the Eastern Cape</h1><p>We supply and install equipment for our customers across the region, and you can contact us for a quote.</p>${body}</main></body></html>`;

function check(key: string, html: string, url = "https://acme.co.za/") {
  const [r] = evaluate(ctxFor(html, { url }), new Set([key]));
  if (!r) throw new Error(key);
  return r.result;
}
const status = (key: string, html: string) => check(key, html).status;

const logos = (n: number, prefix = "logo", alt = "Logo") => Array.from({ length: n }, (_, i) => `<li><img src="/img/${prefix}-${i}.png" alt="${alt} ${i}"></li>`).join("");
const wall = (heading: string, n = 5, cls = "logos", alt = "Logo") => `<section class="${cls}"><h2>${heading}</h2><ul>${logos(n, "logo", alt)}</ul></section>`;

describe("capacity.careers_page", () => {
  const k = "capacity.careers_page";
  it("finds a careers page by path, by link text, or on a recruitment platform", () => {
    expect(status(k, page('<footer><a href="/careers/">Work at Acme</a></footer>'))).toBe("PRESENT");
    expect(status(k, page('<footer><a href="/about/team">Vacancies</a></footer>'))).toBe("PRESENT");
    expect(status(k, page('<footer><a href="https://acme.bamboohr.com/hiring">Open roles</a></footer>'))).toBe("PRESENT");
    expect(status(k, page('<footer><a href="https://www.linkedin.com/company/acme/jobs/">LinkedIn</a></footer>'))).toBe("PRESENT");
  });

  it("finds a job posting in structured data", () => {
    const ld = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Fitter"}</script>';
    expect(status(k, page("", ld))).toBe("PRESENT");
  });

  it("does not decide on a bare 'jobs' link, which trade sites use for completed work", () => {
    expect(status(k, page('<a href="/jobs/">Recent jobs</a>'))).toBe("INDETERMINATE");
    expect(status(k, page('<a href="/our-work/">Jobs</a>'))).toBe("INDETERMINATE");
  });

  it("does not take sponsorship or business 'opportunities' for vacancies", () => {
    expect(status(k, page('<a href="/opportunities/">Sponsorship opportunities</a>'))).toBe("ABSENT");
  });

  it("is ABSENT with no such link, and abstains on a page it cannot read", () => {
    expect(status(k, page(""))).toBe("ABSENT");
    const af = `<html lang="af"><body><h1>Welkom by ons besigheid</h1><p>Ons verskaf toerusting aan die hele streek en ons is baie trots daarop.</p><a href="/loopbane/">Loopbane</a></body></html>`;
    expect(status(k, af)).toBe("INDETERMINATE");
  });
});

describe("capacity.multiple_locations", () => {
  const k = "capacity.multiple_locations";
  const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const addr = (street: string, town: string) => ({ "@type": "PostalAddress", streetAddress: street, addressLocality: town });

  it("is PRESENT for two distinct addresses of the business", () => {
    const org = { "@context": "https://schema.org", "@type": "Organization", name: "Acme", department: [{ "@type": "Store", address: addr("1 Main Road", "Gqeberha") }, { "@type": "Store", address: addr("9 Oxford Street", "East London") }] };
    expect(status(k, page("", ld(org)))).toBe("PRESENT");
    const graph = { "@context": "https://schema.org", "@graph": [{ "@type": "LocalBusiness", address: addr("1 Main Road", "Gqeberha") }, { "@type": "LocalBusiness", address: addr("5 Long Street", "Cape Town") }] };
    expect(status(k, page("", ld(graph)))).toBe("PRESENT");
  });

  it("reads microdata addresses too", () => {
    const md = (s: string, t: string) => `<div itemscope itemtype="https://schema.org/PostalAddress"><span itemprop="streetAddress">${s}</span> <span itemprop="addressLocality">${t}</span></div>`;
    expect(status(k, page(md("1 Main Road", "Gqeberha") + md("2 Durban Road", "Mthatha")))).toBe("PRESENT");
  });

  it("does not count the same address twice, an event venue, or a job location", () => {
    const org = { "@type": "LocalBusiness", address: addr("1 Main Road", "Gqeberha") };
    // One own address is never claimed as one location: INDETERMINATE, not PRESENT and not ABSENT.
    expect(status(k, page("", ld([org, { ...org }])))).toBe("INDETERMINATE");
    const event = { "@type": "SportsEvent", name: "Final", location: { "@type": "Place", address: addr("Nelson Mandela Bay Stadium", "Gqeberha") } };
    expect(status(k, page("", ld([org, event])))).toBe("INDETERMINATE");
    const job = { "@type": "JobPosting", jobLocation: { "@type": "Place", address: addr("7 Harbour Road", "Saldanha") } };
    expect(status(k, page("", ld([org, job])))).toBe("INDETERMINATE");
    expect(check(k, page("", ld([org, event]))).evidence.map((e) => e.value)).toEqual(["1 Main Road, Gqeberha"]);
  });

  it("never counts locations from prose", () => {
    expect(status(k, page("<p>Branches in Gqeberha, East London and Mthatha.</p>"))).toBe("INDETERMINATE");
  });

  it("says so when the structured data cannot be read", () => {
    expect(check(k, page("", '<script type="application/ld+json">{"@type": "LocalBusiness", broken</script>')).detail).toMatch(/could not be read/);
  });
});

describe("capacity.online_shop", () => {
  const k = "capacity.online_shop";
  it("is PRESENT for a cart, checkout or add-to-cart control", () => {
    expect(status(k, page('<a href="/cart/">Cart (0)</a>'))).toBe("PRESENT");
    expect(status(k, page('<a href="/?add-to-cart=42">Buy</a>'))).toBe("PRESENT");
    expect(status(k, page('<button class="single_add_to_cart_button button">Add</button>'))).toBe("PRESENT");
    expect(status(k, page('<form action="/checkout"><button>Pay</button></form>'))).toBe("PRESENT");
  });

  it("is PRESENT on a hosted store platform", () => {
    expect(status(k, page("", '<script src="https://cdn.shopify.com/s/files/theme.js"></script>'))).toBe("PRESENT");
  });

  it("does not decide on a shop link, WooCommerce assets alone, or priced products without a cart", () => {
    expect(status(k, page('<a href="/shop/">Shop now</a>'))).toBe("INDETERMINATE");
    expect(status(k, page("", '<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css">'))).toBe("INDETERMINATE");
    const product = '<script type="application/ld+json">{"@type":"Product","name":"Hard hat","offers":{"@type":"Offer","price":"120"}}</script>';
    expect(status(k, page("", product))).toBe("INDETERMINATE");
  });

  it("does not count a product catalogue page or another site's cart", () => {
    expect(status(k, page('<a href="/products/hard-hats/">Hard hats</a>'))).toBe("ABSENT");
    expect(status(k, page('<a href="https://takealot.com/cart">Buy on Takealot</a>'))).toBe("ABSENT");
  });
});

describe("capacity.client_logo_wall and capacity.sponsor_section: telling them apart", () => {
  const both = (html: string) => [status("capacity.client_logo_wall", html), status("capacity.sponsor_section", html)];

  it("a wall labelled clients is a client wall and not a sponsor section", () => {
    expect(both(page(wall("Our clients")))).toEqual(["PRESENT", "ABSENT"]);
    expect(both(page(wall("Trusted by")))).toEqual(["PRESENT", "ABSENT"]);
    // Labelled only by its class, in the footer.
    expect(both(page(`<footer><div class="client-logos">${logos(5).replace(/<\/?li>/g, "")}</div></footer>`))).toEqual(["PRESENT", "ABSENT"]);
  });

  it("a wall labelled sponsors is a sponsor section and not a client wall", () => {
    expect(both(page(wall("Our sponsors")))).toEqual(["ABSENT", "PRESENT"]);
    expect(both(page(wall("Sponsors & partners")))).toEqual(["ABSENT", "PRESENT"]);
    expect(both(page(wall("Proudly supported by")))).toEqual(["ABSENT", "PRESENT"]);
  });

  it("a wall whose label does not say whose logos they are is INDETERMINATE for both", () => {
    expect(both(page(wall("Our partners")))).toEqual(["INDETERMINATE", "INDETERMINATE"]);
    expect(both(page(wall("Clients and sponsors")))).toEqual(["INDETERMINATE", "INDETERMINATE"]);
    expect(both(page(`<section><ul>${logos(6)}</ul></section>`))).toEqual(["INDETERMINATE", "INDETERMINATE"]);
  });

  it("brands a supplier stocks, a photo gallery, a team or a product grid are not walls of either", () => {
    expect(both(page(wall("Brands we stock")))).toEqual(["ABSENT", "ABSENT"]);
    expect(both(page(`<section><ul>${logos(6, "match-photo", "Players at the final")}</ul></section>`))).toEqual(["ABSENT", "ABSENT"]);
    expect(both(page(wall("Meet the team", 5, "team", "Photo of a director")))).toEqual(["ABSENT", "ABSENT"]);
    const grid = `<section><h2>Featured</h2>${Array.from({ length: 6 }, (_, i) => `<article><img src="/p/${i}.jpg" alt="Product"><h3>Safety boot model ${i}</h3><p>Steel toe cap, SABS approved, sizes 4 to 13. R 1 250.00 incl. VAT</p></article>`).join("")}</section>`;
    expect(both(page(grid))).toEqual(["ABSENT", "ABSENT"]);
  });

  it("selling sponsorship is inventory, not sponsors", () => {
    const html = page('<section><h2>Become a sponsor</h2><p>Sponsorship packages include stadium branding.</p><a href="/sponsorship-packages/">Sponsorship packages</a></section>');
    expect(status("capacity.sponsor_section", html)).toBe("ABSENT");
  });

  it("a sponsors heading or link that names no one is INDETERMINATE, not PRESENT", () => {
    expect(status("capacity.sponsor_section", page('<section><h2>Our sponsors</h2><p>Thank you to everyone who supports the club.</p></section>'))).toBe("INDETERMINATE");
    expect(status("capacity.sponsor_section", page('<a href="/sponsors/">Sponsors</a>'))).toBe("INDETERMINATE");
  });

  it("sponsors listed as links to their sites are PRESENT", () => {
    const links = '<section><h2>Our sponsors</h2><p><a href="https://bank.co.za">Bank</a> <a href="https://brewery.co.za">Brewery</a> <a href="https://motors.co.za">Motors</a></p></section>';
    expect(status("capacity.sponsor_section", page(links))).toBe("PRESENT");
  });

  it("two labelled logos are evidence; one is a boundary case; two unlabelled logos are nothing", () => {
    // A B2B supplier naming two clients is evidence of operating scale.
    expect(both(page(wall("Trusted by", 2)))).toEqual(["PRESENT", "ABSENT"]);
    expect(both(page(wall("Our sponsors", 2)))).toEqual(["ABSENT", "PRESENT"]);
    expect(status("capacity.client_logo_wall", page(wall("Our clients", 1)))).toBe("INDETERMINATE");
    // Two or three unlabelled logos are as likely to be payment badges or icons.
    expect(both(page(`<section><ul>${logos(3)}</ul></section>`))).toEqual(["ABSENT", "ABSENT"]);
  });

  it("never treats the site header or navigation as a wall", () => {
    const header = `<!doctype html><html lang="en"><head><title>Acme</title></head><body><header class="clients-bar"><img src="/logo.png" alt="Acme logo"><img src="/badge.png" alt="Client logo"></header><main><h1>Industrial supplies</h1><p>We supply and install equipment for our customers across the region, and you can contact us for a quote.</p></main></body></html>`;
    expect(both(header)).toEqual(["ABSENT", "ABSENT"]);
  });

  it("abstains on a logo group in a language its labels cannot read", () => {
    const af = `<html lang="af"><body><h1>Welkom</h1><p>Ons is trots op ons werk in die hele streek en ons help almal.</p><section><h2>Ons borge</h2><ul>${logos(5)}</ul></section></body></html>`;
    expect(both(af)).toEqual(["INDETERMINATE", "INDETERMINATE"]);
  });

  it("records the group, its label and its alt texts as evidence", () => {
    const r = check("capacity.client_logo_wall", page(wall("Our clients", 5, "logos", "Client")));
    expect(r.evidence[0]).toMatchObject({ claim: "Client logos", value: '5 images under "Our clients"' });
    expect(r.evidence[0]?.locator).toContain("ul");
  });
});

describe("capacity.accreditation", () => {
  const k = "capacity.accreditation";
  it("is PRESENT for a named body or an ISO management-system certification", () => {
    expect(status(k, page("<p>We are proud members of the Master Builders Association.</p>"))).toBe("PRESENT");
    expect(status(k, page("<p>All our plumbers are registered with PIRB.</p>"))).toBe("PRESENT");
    expect(status(k, page("<p>Our quality system is ISO 9001 certified.</p>"))).toBe("PRESENT");
    expect(check(k, page("<p>Our attorneys are members of the Legal Practice Council. Latest news below.</p>")).evidence[0]?.value).toBe("Legal Practice Council");
  });

  it("does not count product approvals, statutory registrations or B-BBEE levels", () => {
    // Approval or certification wording with no body named is uncertain, never PRESENT.
    expect(status(k, page("<p>SABS-approved hard hats and certified boots.</p>"))).toBe("INDETERMINATE");
    expect(status(k, page("<p>Certificate of compliance issued on every installation.</p>"))).toBe("INDETERMINATE");
    expect(status(k, page("<p>Registered with the CIPC since 2004.</p>"))).toBe("ABSENT");
    expect(status(k, page("<p>We are members of the B-BBEE Level 1 club.</p>"))).toBe("ABSENT");
    expect(status(k, page("<p>Meet the members of our team.</p>"))).toBe("ABSENT");
  });

  it("is INDETERMINATE for an accreditations heading that names no body in text", () => {
    expect(status(k, page(`<section><h2>Accreditations</h2><ul>${logos(3)}</ul></section>`))).toBe("INDETERMINATE");
  });
});

describe("capacity checks never judge a weakness", () => {
  const capacity = ALL_CHECKS.filter((c) => c.category === "capacity");

  it("there are six, all info, and none returns PASS or FAIL on any fixture above", () => {
    expect(capacity.map((c) => c.key).sort()).toEqual([
      "capacity.accreditation",
      "capacity.careers_page",
      "capacity.client_logo_wall",
      "capacity.multiple_locations",
      "capacity.online_shop",
      "capacity.sponsor_section",
    ]);
    expect(capacity.every((c) => c.severity === "info")).toBe(true);
  });

  it("a capacity check that returned FAIL would be reported as ERROR, with no severity", () => {
    const rogue: CheckDefinition = { ...(capacity[0] as CheckDefinition), key: "capacity.rogue", run: () => ({ status: "FAIL", confidence: 1, detail: "x", evidence: [] }) };
    (ALL_CHECKS as CheckDefinition[]).push(rogue);
    try {
      const [r] = evaluate(ctxFor(page("")), new Set(["capacity.rogue"]));
      expect(r?.result.status).toBe("ERROR");
      expect(r?.severity).toBeNull();
    } finally {
      (ALL_CHECKS as CheckDefinition[]).pop();
    }
  });

  it("and a weakness check cannot return PRESENT", () => {
    const rogue: CheckDefinition = { ...(ALL_CHECKS[0] as CheckDefinition), key: "tech.rogue", run: () => ({ status: "PRESENT", confidence: 1, detail: "x", evidence: [] }) };
    (ALL_CHECKS as CheckDefinition[]).push(rogue);
    try {
      expect(evaluate(ctxFor(page("")), new Set(["tech.rogue"]))[0]?.result.status).toBe("ERROR");
    } finally {
      (ALL_CHECKS as CheckDefinition[]).pop();
    }
  });
});
