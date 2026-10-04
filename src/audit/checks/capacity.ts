// Capacity checks (Phase 6 addendum, authorised in Phase 9): structural markers that a
// business operates at scale. They evidence capacity, not intent: a business with three
// branches and an open vacancy is demonstrably operating at scale, not demonstrably in the
// market for a website. They feed commercial potential and never become signals.
//
// Each returns PRESENT, ABSENT, INDETERMINATE or NOT_APPLICABLE; never PASS or FAIL, so
// none carries a severity. Where markup cannot tell two things apart (a sponsor wall and a
// client logo wall look alike), the answer is INDETERMINATE rather than a guess.
import type { Element } from "domhandler";
import { type PageDoc, excerptOf, jsonLd, ldTypes, pathOf, resolveHref, sameSite, textOf, visible } from "../document";
import type { CheckDefinition, EvidenceItem } from "../types";
import { absent, indeterminate, notEnglish, present } from "./result";

const V = "1";

// --- shared -----------------------------------------------------------------

const segments = (u: URL) => u.pathname.toLowerCase().split("/").filter(Boolean);

/** id/class/aria-label words: "client-logos" → "client logos", "sponsorWall" → "sponsor wall". */
const attrWords = (el: Element) =>
  [el.attribs?.id, el.attribs?.class, el.attribs?.["aria-label"]]
    .filter(Boolean)
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase();

const linkEvidence = (doc: PageDoc, el: Element, claim: string): EvidenceItem => ({
  claim,
  value: el.attribs?.href ?? null,
  excerpt: textOf(doc.$, el) || excerptOf(doc.$, el),
  locator: pathOf(el),
});

const order = new WeakMap<PageDoc, Map<Element, number>>();
function docOrder(doc: PageDoc): Map<Element, number> {
  let m = order.get(doc);
  if (!m) {
    m = new Map((doc.$("*").toArray() as Element[]).map((el, i) => [el, i]));
    order.set(doc, m);
  }
  return m;
}

const ancestors = (el: Element, n: number): Element[] => {
  const out: Element[] = [];
  let cur = el.parent;
  while (cur && cur.type === "tag" && out.length < n) {
    out.push(cur as Element);
    cur = (cur as Element).parent;
  }
  return out;
};

const HEADINGS = "h1, h2, h3, h4, h5, h6, [role='heading']";

/** The heading that labels an element: the first heading inside it, else the closest one before it within three ancestors. */
function headingFor(doc: PageDoc, el: Element): Element | null {
  const inside = doc.$(el).find(HEADINGS).toArray() as Element[];
  if (inside[0]) return inside[0];
  const pos = docOrder(doc);
  const at = pos.get(el) ?? 0;
  for (const anc of ancestors(el, 3)) {
    const before = (doc.$(anc).find(HEADINGS).toArray() as Element[]).filter((h) => (pos.get(h) ?? Infinity) < at);
    const last = before[before.length - 1];
    if (last) return last;
  }
  return null;
}

// --- careers ----------------------------------------------------------------

const CAREER_SEGMENT = /^(careers?|vacanc(y|ies)|join-?us|join-?our-?team|work-?with-?us|work-?for-?us|we-?are-?hiring|employment)$/;
const JOB_SEGMENT = /^jobs?$/;
const CAREER_TEXT = /^(careers?|vacancies|current vacancies|job (openings|opportunities)|join (our|the) team|work (with|for) us|we('re| are) hiring|employment( opportunities)?)$/i;
const JOB_TEXT = /^jobs?$/i;
const RECRUITMENT_HOSTS =
  /(^|\.)(greenhouse\.io|lever\.co|workable\.com|bamboohr\.com|recruitee\.com|smartrecruiters\.com|myworkdayjobs\.com|teamtailor\.com|jobvite\.com|breezy\.hr|pnet\.co\.za|careers24\.com|careerjunction\.co\.za)$/i;

// --- locations --------------------------------------------------------------

/** Addresses inside these are someone else's (a venue, a customer, a job location), not a branch. */
const NOT_OWN_ADDRESS = /(Event|^Person$|^Offer$|^AggregateOffer$|^Product$|^Review$|^JobPosting$|^Course$|^Trip$|^Reservation$)/;

interface Address {
  label: string;
  key: string;
}

function addressKey(a: Record<string, unknown>): Address | null {
  const part = (k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");
  const label = [part("streetAddress"), part("addressLocality"), part("postalCode")].filter(Boolean).join(", ");
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return key ? { label, key } : null;
}

function collectAddresses(node: unknown, out: Address[], excluded = false, depth = 0): void {
  if (depth > 12 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectAddresses(n, out, excluded, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  const types = ldTypes(o);
  const ex = excluded || types.some((t) => NOT_OWN_ADDRESS.test(t));
  if (!ex && types.includes("PostalAddress")) {
    const a = addressKey(o);
    if (a) out.push(a);
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === "address" && typeof v === "string" && !ex) {
      const key = v.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (key) out.push({ label: v.trim(), key });
    } else collectAddresses(v, out, ex, depth + 1);
  }
}

function microdataAddresses(doc: PageDoc): Address[] {
  const out: Address[] = [];
  for (const el of visible(doc, "[itemtype*='PostalAddress' i]")) {
    if (ancestors(el, 20).some((a) => /(Event|Person|Offer|Product|JobPosting)$/i.test(a.attribs?.itemtype ?? ""))) continue;
    const prop = (name: string) => doc.$(el).find(`[itemprop='${name}']`).first().text().replace(/\s+/g, " ").trim();
    const a = addressKey({ streetAddress: prop("streetAddress"), addressLocality: prop("addressLocality"), postalCode: prop("postalCode") });
    if (a) out.push(a);
  }
  return out;
}

// --- online shop ------------------------------------------------------------

const CART_SEGMENT = /^(cart|basket|checkout|shopping-?cart|my-?cart|trolley)$/;
// Not "products": a product catalogue page is not a shop.
const SHOP_SEGMENT = /^(shop|store|online-?(shop|store))$/;
const ADD_TO_CART = /add[-_ ]?to[-_ ]?(cart|basket)|single_add_to_cart|addtocart|product-form__cart/i;
const CART_TEXT = /^(cart|basket|checkout|view cart|my cart|add to (cart|basket))$/i;
const SHOP_TEXT = /^(shop( now| online)?|online (shop|store)|(visit|browse) (the|our) (shop|store)|buy (now|online))$/i;

// --- logo walls -------------------------------------------------------------

const CLIENT_LABEL = /\b(clients?|customers?|trusted by|who we('ve)? work(ed)? with|we('ve| have) worked with|brands that trust us|companies we work with)\b/i;
const SPONSOR_LABEL = /\b(sponsors?|sponsored by|proudly supported by|supported by|funders?|funded by|backers?)\b/i;
/** Selling sponsorship is inventory, not evidence of sponsors: removed before labelling. */
const SPONSOR_SALES = /\b(become an? (sponsor|partner)|partner with (us|the [a-z ]+)|sponsorship (packages?|opportunit(y|ies)|options|enquir(y|ies)|prospectus)|advertise with us)\b/gi;
const PARTNER_LABEL = /\bpartners?\b/i;
const OTHER_LABEL =
  /\b(brands?|suppliers?|manufacturers?|stockists?|distributors?|team|staff|our people|gallery|photos?|products?|projects?|portfolio|our work|services?|accreditations?|memberships?|affiliations?|certifications?|awards?|news|events?|fixtures?)\b/i;

type WallKind = "client" | "sponsor" | "ambiguous" | "other";

interface LogoGroup {
  el: Element;
  count: number;
  kind: WallKind;
  label: string;
  alts: string[];
}

const imagesIn = (doc: PageDoc, el: Element) =>
  (doc.$(el).find("img, svg").toArray() as Element[]).filter((img) => !ancestors(img, 30).some((a) => a.name === "svg") && doc.offsets.has(img));

/** Tight groups of images with little text: logo walls, but also galleries and team photos. */
function imageGroups(doc: PageDoc, minLogos: number, maxTextPerLogo: number): { el: Element; imgs: Element[] }[] {
  const candidates = visible(doc, "section, div, ul, ol, aside, footer, figure, article, table, p")
    .map((el) => ({ el, imgs: imagesIn(doc, el) }))
    .filter((c) => c.imgs.length >= minLogos && textOf(doc.$, c.el).length <= maxTextPerLogo * c.imgs.length);
  // Keep the tightest container: drop any candidate that contains another candidate.
  return candidates.filter((c) => !candidates.some((d) => d !== c && ancestors(d.el, 30).includes(c.el)));
}

function classify(doc: PageDoc, el: Element, imgs: Element[]): LogoGroup {
  const heading = headingFor(doc, el);
  const attrs = [el, ...ancestors(el, 3)].map(attrWords).join(" ");
  const alts = imgs.map((i) => (i.attribs?.alt ?? "").trim()).filter(Boolean);
  const srcs = imgs.map((i) => (i.attribs?.src ?? "").replace(/[/._-]+/g, " ")).join(" ");
  const raw = [heading ? textOf(doc.$, heading) : "", attrs, alts.join(" "), srcs].join(" | ");
  const label = raw.replace(SPONSOR_SALES, " ");
  const client = CLIENT_LABEL.test(label);
  const sponsor = SPONSOR_LABEL.test(label);
  const partner = PARTNER_LABEL.test(label);
  let kind: WallKind;
  if (sponsor && !client) kind = "sponsor";
  else if (client && !sponsor && !partner) kind = "client";
  else if (client || sponsor || partner) kind = "ambiguous";
  else if (OTHER_LABEL.test(label)) kind = "other";
  else {
    // Unlabelled: a wall of logos is ambiguous; a group of photographs is not a wall at all.
    const logoish = /\blogos?\b/i.test(`${attrs} ${alts.join(" ")} ${srcs}`);
    kind = logoish ? "ambiguous" : "other";
  }
  return { el, count: imgs.length, kind, label: heading ? textOf(doc.$, heading) : attrs.trim() || "(unlabelled)", alts };
}

const groupEvidence = (doc: PageDoc, g: LogoGroup, claim: string): EvidenceItem => ({
  claim,
  value: `${g.count} images under "${g.label}"`,
  excerpt: g.alts.slice(0, 6).join("; ") || excerptOf(doc.$, g.el),
  locator: pathOf(g.el),
});

function logoGroups(doc: PageDoc, minLogos: number, maxTextPerLogo: number): LogoGroup[] {
  return imageGroups(doc, minLogos, maxTextPerLogo).map((g) => classify(doc, g.el, g.imgs));
}

/** Headings or links that announce a section without the section naming anyone. */
function labelledOnly(doc: PageDoc, re: RegExp): Element | null {
  for (const el of visible(doc, `${HEADINGS}, a[href]`)) {
    const text = textOf(doc.$, el).replace(SPONSOR_SALES, " ");
    const href = el.name === "a" ? (resolveHref(doc, el.attribs?.href)?.pathname ?? "").replace(/[/_-]+/g, " ") : "";
    if (re.test(text) || (href && re.test(href.replace(SPONSOR_SALES, " ")))) return el;
  }
  return null;
}

// --- accreditation ----------------------------------------------------------

const MEMBERSHIP_STATEMENT =
  /\b(?:[Mm]embers? of|[Aa]ccredited (?:by|with)|[Rr]egistered with|[Aa]ffiliated (?:to|with)|[Cc]ertified by)\s+(?:the\s+)?([A-Z][\w&'-]*(?:\s+(?:of|and|for|the|&|[A-Z][\w&'-]*)){0,7})/g;
const BODY_WORD =
  /\b(Council|Institute|Institution|Association|Board|Society|Federation|Chamber|Bureau|Guild|Authority|Academy|College|Union|Organi[sz]ation|Commission|Forum|Alliance|Registry|Register)\b/;
const ACRONYM = /^[A-Z][A-Z&]{1,7}\b/;
/** Statutory registrations and scorecards are not industry bodies (B-BBEE is human-only territory). */
const NOT_A_BODY = /\b(CIPC|Companies and Intellectual Property|SARS|Revenue Service|Department of|Compensation Fund|UIF|VAT|B-?BBEE|BEE|Level \d)\b/;
const ISO_CERT = /\bISO\s?(9001|14001|45001|27001|22000|13485|17025|50001)\b[^.]{0,40}?\b(certifi\w*|accredit\w*|registered|compliant)\b|\b(certifi\w*|accredit\w*)\b[^.]{0,40}?\bISO\s?(9001|14001|45001|27001|22000|13485|17025|50001)\b/i;
const ACCREDITATION_HEADING = /\b(accreditations?|memberships?|affiliations?|professional bodies|industry bodies|certifications?)\b/i;

export const capacityChecks: CheckDefinition[] = [
  {
    key: "capacity.careers_page",
    name: "Careers or vacancies page linked",
    category: "capacity",
    severity: "info",
    version: V,
    description:
      "PRESENT for a link to a careers or vacancies page (path or link text), a careers/jobs subdomain or recruitment platform, or JobPosting structured data. A link labelled only 'Jobs' is INDETERMINATE: trade sites use it for completed work.",
    evidenceRecorded: "The careers link, recruitment-platform link or JobPosting entry.",
    run({ doc }) {
      if (jsonLd(doc).items.some((i) => ldTypes(i).includes("JobPosting"))) {
        return present("The page publishes a job posting in structured data", 0.9, [{ claim: "JobPosting structured data", value: null, locator: "script[type=application/ld+json]" }]);
      }
      let jobsOnly: Element | null = null;
      for (const el of visible(doc, "a[href]")) {
        const u = resolveHref(doc, el.attribs?.href);
        if (!u || !/^https?:$/.test(u.protocol)) continue;
        const text = textOf(doc.$, el);
        const segs = segments(u);
        const careersHost = /^(careers|jobs)\./i.test(u.hostname) || RECRUITMENT_HOSTS.test(u.hostname) || (/linkedin\.com$/i.test(u.hostname) && segs.includes("jobs"));
        const careersPath = sameSite(u, doc.url) && segs.some((s) => CAREER_SEGMENT.test(s));
        const careersText = doc.vocabularyReliable && CAREER_TEXT.test(text);
        if (careersHost || careersPath || careersText) return present("A careers or vacancies page is linked", 0.9, [linkEvidence(doc, el, "Careers link")]);
        if (!jobsOnly && sameSite(u, doc.url) && (segs.some((s) => JOB_SEGMENT.test(s)) || JOB_TEXT.test(text))) jobsOnly = el;
      }
      if (jobsOnly) return indeterminate("A 'jobs' page is linked; it may list vacancies or completed work, and was not read", [linkEvidence(doc, jobsOnly, "Jobs link")]);
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      return absent("No careers or vacancies link on the homepage", 0.75, [{ claim: "No careers link matched", value: null, locator: "body" }]);
    },
  },
  {
    key: "capacity.multiple_locations",
    name: "Multiple locations or branches",
    category: "capacity",
    severity: "info",
    version: V,
    description:
      "Counts distinct postal addresses of the business in structured data (JSON-LD or microdata), ignoring event venues, job locations and people. PRESENT at min_distinct_locations (default 2). Never counted from prose; no structured addresses is INDETERMINATE.",
    evidenceRecorded: "Each distinct structured address.",
    params: { min_distinct_locations: { default: 2, min: 2, max: 20, integer: true, description: "Distinct structured addresses that count as multiple locations" } },
    run({ doc }, p) {
      const ld = jsonLd(doc);
      const found: Address[] = [];
      for (const item of ld.items) collectAddresses(item, found);
      found.push(...microdataAddresses(doc));
      const distinct = [...new Map(found.map((a) => [a.key, a])).values()];
      const ev = distinct.map((a) => ({ claim: "Structured postal address", value: a.label, locator: "structured data" }));
      if (distinct.length >= (p.min_distinct_locations as number)) return present(`${distinct.length} distinct addresses in structured data`, 0.85, ev);
      if (distinct.length) return absent("Structured data gives one address (branches not listed there are not counted)", 0.6, ev);
      if (ld.unparseable) return indeterminate("Structured data is present but could not be read", [{ claim: "Unreadable JSON-LD blocks", value: String(ld.unparseable), locator: "script[type=application/ld+json]" }]);
      return indeterminate("No structured address data; locations are not counted from prose");
    },
  },
  {
    key: "capacity.online_shop",
    name: "Online shop or cart",
    category: "capacity",
    severity: "info",
    version: V,
    description:
      "PRESENT for a cart, basket or checkout link, an add-to-cart control, or a hosted-store platform (Shopify, Ecwid). INDETERMINATE when only a shop link, WooCommerce assets or priced products are present: a catalogue without a cart is not a shop.",
    evidenceRecorded: "The cart link, add-to-cart control or platform asset.",
    run({ doc }) {
      for (const el of visible(doc, "a[href], form[action]")) {
        const u = resolveHref(doc, el.attribs?.href ?? el.attribs?.action);
        if (!u || !/^https?:$/.test(u.protocol)) continue;
        const own = sameSite(u, doc.url);
        if ((own && segments(u).some((s) => CART_SEGMENT.test(s))) || u.searchParams.has("add-to-cart")) {
          return present("A cart or checkout is linked", 0.9, [linkEvidence(doc, el, "Cart or checkout link")]);
        }
      }
      const control = visible(doc, "button, input, a, form, [data-action]").find(
        (el) => ADD_TO_CART.test(`${attrWords(el)} ${el.attribs?.name ?? ""} ${el.attribs?.["data-action"] ?? ""}`) || (el.name === "input" && el.attribs?.name === "add-to-cart"),
      );
      if (control) return present("An add-to-cart control is on the page", 0.9, [{ claim: "Add-to-cart control", value: el2label(doc, control), excerpt: excerptOf(doc.$, control), locator: pathOf(control) }]);
      if (doc.vocabularyReliable) {
        const cartText = visible(doc, "a[href], button").find((el) => CART_TEXT.test(textOf(doc.$, el)));
        if (cartText) return present("A cart or checkout control is on the page", 0.85, [{ claim: "Cart control", value: textOf(doc.$, cartText), excerpt: excerptOf(doc.$, cartText), locator: pathOf(cartText) }]);
      }
      const assets = (doc.$("script[src], link[href]").toArray() as Element[]).map((el) => ({ el, url: el.attribs?.src ?? el.attribs?.href ?? "" }));
      const hosted = assets.find((a) => /cdn\.shopify\.com|app\.ecwid\.com/i.test(a.url));
      if (hosted) return present("The site runs on a hosted store platform", 0.8, [{ claim: "Store platform asset", value: hosted.url, locator: pathOf(hosted.el) }]);
      const woo = assets.find((a) => /\/plugins\/woocommerce\//i.test(a.url)) ?? (/\bwoocommerce\b/.test(doc.$("body").attr("class") ?? "") ? { el: doc.$("body").get(0) as Element, url: "body.woocommerce" } : undefined);
      if (woo) return indeterminate("WooCommerce is installed but no cart or add-to-cart is on the homepage (catalogue mode is common)", [{ claim: "WooCommerce asset", value: woo.url, locator: pathOf(woo.el) }]);
      const shopLink = visible(doc, "a[href]").find((el) => {
        const u = resolveHref(doc, el.attribs?.href);
        return !!u && sameSite(u, doc.url) && (segments(u).some((s) => SHOP_SEGMENT.test(s)) || (doc.vocabularyReliable && SHOP_TEXT.test(textOf(doc.$, el))));
      });
      if (shopLink) return indeterminate("A shop page is linked but was not read; no cart or checkout is on the homepage", [linkEvidence(doc, shopLink, "Shop link")]);
      if (jsonLd(doc).items.some((i) => ldTypes(i).includes("Product") && !!(i as Record<string, unknown>).offers)) {
        return indeterminate("Priced products are described in structured data, but there is no cart or checkout", [{ claim: "Product with offer", value: null, locator: "script[type=application/ld+json]" }]);
      }
      return absent("No cart, checkout, add-to-cart or store platform on the homepage", 0.75, [{ claim: "No shop marker matched", value: null, locator: "body" }]);
    },
  },
  {
    key: "capacity.client_logo_wall",
    name: "Client or customer logo wall",
    category: "capacity",
    severity: "info",
    version: V,
    description:
      "PRESENT for a tight group of at least min_logos images with little text, labelled as clients or customers (heading, class or id, alt text, file path). A group labelled partners, both clients and sponsors, or unlabelled logos is INDETERMINATE: those look the same in markup as a sponsor wall.",
    evidenceRecorded: "The group's location, label, image count and alt texts.",
    params: {
      min_logos: { default: 4, min: 2, max: 30, integer: true, description: "Images a group needs to count as a wall" },
      max_text_chars_per_logo: { default: 40, min: 10, max: 200, integer: true, description: "A group with more visible text than this per image is content, not a logo wall" },
    },
    run({ doc }, p) {
      const groups = logoGroups(doc, p.min_logos as number, p.max_text_chars_per_logo as number);
      if (groups.length && !doc.vocabularyReliable) return notEnglish(doc.lang);
      const clients = groups.find((g) => g.kind === "client");
      if (clients) return present(`A wall of ${clients.count} client logos`, 0.8, [groupEvidence(doc, clients, "Client logo wall")]);
      const unclear = groups.filter((g) => g.kind === "ambiguous");
      if (unclear.length) return indeterminate("A logo group is present but its label does not say whether these are clients or sponsors", unclear.map((g) => groupEvidence(doc, g, "Logo group, unclear whose")));
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      const few = labelledOnly(doc, CLIENT_LABEL);
      return absent(
        few ? `Clients are mentioned ("${textOf(doc.$, few)}") but no group of ${p.min_logos} or more client logos` : "No client logo wall on the homepage",
        0.7,
        few ? [{ claim: "Client heading or link without a logo wall", value: textOf(doc.$, few), locator: pathOf(few) }] : [{ claim: "No client logo wall matched", value: null, locator: "body" }],
      );
    },
  },
  {
    key: "capacity.sponsor_section",
    name: "Sponsor or partner section",
    category: "capacity",
    severity: "info",
    version: V,
    description:
      "PRESENT for a group of at least min_sponsors logos, or links to that many distinct external sites, labelled as sponsors (partners together with sponsors counts). Sponsorship packages for sale are inventory, not sponsors. Partners alone, clients and sponsors together, unlabelled logos, or a sponsors heading or link that names no one are INDETERMINATE.",
    evidenceRecorded: "The section's location, label and the logos or links it names.",
    params: {
      min_sponsors: { default: 3, min: 2, max: 30, integer: true, description: "Logos or distinct external links a sponsor section needs" },
      max_text_chars_per_logo: { default: 40, min: 10, max: 200, integer: true, description: "A group with more visible text than this per image is content, not a logo wall" },
    },
    run({ doc }, p) {
      const min = p.min_sponsors as number;
      const groups = logoGroups(doc, min, p.max_text_chars_per_logo as number);
      if (groups.length && !doc.vocabularyReliable) return notEnglish(doc.lang);
      const wall = groups.find((g) => g.kind === "sponsor");
      if (wall) return present(`A sponsor section with ${wall.count} logos`, 0.8, [groupEvidence(doc, wall, "Sponsor logo wall")]);
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      // Sponsors listed as links rather than logos.
      for (const h of visible(doc, HEADINGS).filter((h) => SPONSOR_LABEL.test(textOf(doc.$, h).replace(SPONSOR_SALES, " ")) && !CLIENT_LABEL.test(textOf(doc.$, h)))) {
        const section = (h.parent && h.parent.type === "tag" ? (h.parent as Element) : null) ?? h;
        const hosts = new Set(
          (doc.$(section).find("a[href]").toArray() as Element[])
            .map((a) => resolveHref(doc, a.attribs?.href))
            .filter((u): u is URL => !!u && /^https?:$/.test(u.protocol) && !sameSite(u, doc.url))
            .map((u) => u.hostname.replace(/^www\./, "")),
        );
        if (hosts.size >= min) return present(`A sponsor section links to ${hosts.size} sponsors`, 0.75, [{ claim: "Sponsor section links", value: [...hosts].join(", "), excerpt: textOf(doc.$, h), locator: pathOf(section) }]);
      }
      const unclear = groups.filter((g) => g.kind === "ambiguous");
      if (unclear.length) return indeterminate("A logo group is present but its label does not say whether these are sponsors or clients", unclear.map((g) => groupEvidence(doc, g, "Logo group, unclear whose")));
      const announced = labelledOnly(doc, SPONSOR_LABEL);
      if (announced) {
        return indeterminate("A sponsors heading or page link is present, but this page names no identifiable sponsors", [
          { claim: "Sponsors heading or link", value: announced.attribs?.href ?? textOf(doc.$, announced), excerpt: textOf(doc.$, announced), locator: pathOf(announced) },
        ]);
      }
      return absent("No sponsor or partner section on the homepage", 0.7, [{ claim: "No sponsor section matched", value: null, locator: "body" }]);
    },
  },
  {
    key: "capacity.accreditation",
    name: "Accreditation or industry body membership",
    category: "capacity",
    severity: "info",
    version: V,
    description:
      "PRESENT for a statement naming a body the business belongs to or is accredited by ('members of the Legal Practice Council', 'registered with PIRB') or an ISO management-system certification. Product approvals ('SABS-approved hard hats'), statutory registrations (CIPC, SARS) and B-BBEE levels do not count. A heading such as 'Accreditations' with no body named is INDETERMINATE.",
    evidenceRecorded: "The membership statement or certification and where it appears.",
    run({ doc }) {
      const iso = doc.text.match(ISO_CERT)?.[0];
      if (iso) return present("An ISO management-system certification is stated", 0.85, [{ claim: "ISO certification statement", value: iso, locator: "body text" }]);
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      for (const m of doc.text.matchAll(MEMBERSHIP_STATEMENT)) {
        const body = (m[1] ?? "").replace(/[.,;:]+$/, "").replace(/\s+(of|and|for|the|&)$/i, "");
        if ((BODY_WORD.test(body) || ACRONYM.test(body)) && !NOT_A_BODY.test(body)) {
          return present(`Membership of or accreditation by ${body} is stated`, 0.85, [{ claim: "Membership or accreditation statement", value: body, excerpt: m[0], locator: "body text" }]);
        }
      }
      const heading = visible(doc, HEADINGS).find((h) => ACCREDITATION_HEADING.test(textOf(doc.$, h)));
      if (heading) return indeterminate("An accreditation or membership section is present but names no body in text", [{ claim: "Accreditation heading", value: textOf(doc.$, heading), locator: pathOf(heading) }]);
      return absent("No accreditation or industry body membership stated on the homepage", 0.7, [{ claim: "No membership statement matched", value: null, locator: "body" }]);
    },
  },
];

function el2label(doc: PageDoc, el: Element): string {
  return textOf(doc.$, el) || el.attribs?.value || el.attribs?.name || el.attribs?.class || el.name;
}
