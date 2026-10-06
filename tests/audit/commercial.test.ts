// Commercial-offer checks: what an organisation publishes about how it sells and buys.
// The bounds matter more than the hits: a sponsorship offer, not a generic partners page;
// the organisation's own tender process, not a supplier's link to a national portal.
import { describe, expect, it } from "vitest";
import { evaluate } from "@/audit/registry";
import { ctxFor } from "./helpers";

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><title>Kariega Rugby Club</title></head><body><header><a href="/">Home</a><nav><a href="/fixtures/">Fixtures</a><a href="/contact/">Contact us</a></nav></header><main><h1>Kariega Rugby Club</h1><p>We play in the Eastern Province league and welcome supporters to every home match at our ground.</p>${body}</main></body></html>`;

function result(key: string, html: string) {
  const [r] = evaluate(ctxFor(html, { url: "https://kariegarugby.co.za/" }), new Set([key]));
  if (!r) throw new Error(key);
  return r.result;
}
const status = (key: string, html: string) => result(key, html).status;

describe("commercial.sponsorship_offer", () => {
  const k = "commercial.sponsorship_offer";
  it("is PRESENT for an explicit offer in a heading, link, button or offer path", () => {
    expect(result(k, page('<a href="/sponsorship/">Sponsorship packages</a>'))).toMatchObject({ status: "PRESENT", confidence: 0.9 });
    expect(status(k, page("<h2>Become a sponsor</h2>"))).toBe("PRESENT");
    expect(status(k, page("<button>Sponsor the club</button>"))).toBe("PRESENT");
    expect(status(k, page('<a href="/become-a-sponsor/">Get involved</a>'))).toBe("PRESENT");
  });

  it("counts an offer made only in prose at lower confidence, below the signal's default floor", () => {
    expect(result(k, page("<p>We have sponsorship packages for local businesses of every size.</p>"))).toMatchObject({ status: "PRESENT", confidence: 0.7 });
  });

  it("does not count a generic partners page, thanks to existing sponsors, or a charity sponsorship", () => {
    expect(status(k, page("<h2>Partner with us</h2><p>Work with the club.</p>"))).toBe("ABSENT");
    expect(status(k, page("<h2>Our sponsors</h2><p>Thank you to our sponsors.</p>"))).toBe("ABSENT");
    expect(status(k, page("<p>Sponsor a child through our school programme.</p>"))).toBe("ABSENT");
  });

  it("does not decide on a bare 'Sponsorship' link, which may only thank sponsors", () => {
    expect(status(k, page('<a href="/sponsorship/">Sponsorship</a>'))).toBe("INDETERMINATE");
  });

  it("abstains on a page it cannot read, unless the offer path says it", () => {
    const af = (body: string) => `<html lang="af"><body><h1>Welkom by die klub</h1><p>Ons speel elke Saterdag en ons ondersteuners is altyd welkom.</p>${body}</body></html>`;
    expect(status(k, af("<h2>Borgskap pakkette</h2>"))).toBe("INDETERMINATE");
    expect(status(k, af('<a href="/sponsorship-packages/">Borgskap</a>'))).toBe("PRESENT");
  });
});

describe("commercial.procurement_portal", () => {
  const k = "commercial.procurement_portal";
  it("is PRESENT when the organisation publishes its own tender or supply-chain process", () => {
    expect(result(k, page('<a href="/tenders/">Current tenders</a>'))).toMatchObject({ status: "PRESENT", confidence: 0.85 });
    expect(status(k, page('<a href="/scm/">Supply Chain Management</a>'))).toBe("PRESENT");
    expect(status(k, page("<h2>Supplier registration</h2>"))).toBe("PRESENT");
  });

  it("counts a tender path alone at lower confidence, below the disqualifier's default floor", () => {
    expect(result(k, page('<a href="/procurement/">Doing business with us</a>'))).toMatchObject({ status: "PRESENT", confidence: 0.7 });
  });

  it("does not count a supplier's link to a national portal, or tendering mentioned in prose", () => {
    expect(status(k, page('<a href="https://www.etenders.gov.za/">Tenders</a>'))).toBe("ABSENT");
    expect(status(k, page("<p>We respond to tenders from mines and municipalities.</p>"))).toBe("ABSENT");
    expect(status(k, page('<a href="/quote/">Request a quote</a>'))).toBe("ABSENT");
  });
});
