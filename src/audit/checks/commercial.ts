// Commercial-offer checks (Phase 10): what an organisation publishes about how it sells
// and how it buys. Like capacity checks they record presence, not weakness (PRESENT,
// ABSENT, INDETERMINATE, NOT_APPLICABLE; never a severity). Unlike capacity, each feeds a
// named downstream rule:
//   commercial.sponsorship_offer  → the sponsorship_inventory signal (src/signals/detectors.ts)
//   commercial.procurement_portal → the bureaucratic_procurement disqualifier (src/leads)
import type { Element } from "domhandler";
import { type PageDoc, excerptOf, pathOf, resolveHref, sameSite, textOf, visible } from "../document";
import type { CheckDefinition, EvidenceItem } from "../types";
import { absent, indeterminate, notEnglish, present, conf } from "./result";

const V = "1";

const segments = (u: URL) => u.pathname.toLowerCase().split("/").filter(Boolean);
const ACTION_ELEMENTS = "h1, h2, h3, h4, h5, h6, [role='heading'], a[href], button";

const elementEvidence = (doc: PageDoc, el: Element, claim: string): EvidenceItem => ({
  claim,
  value: textOf(doc.$, el) || (el.attribs?.href ?? null),
  excerpt: excerptOf(doc.$, el),
  locator: pathOf(el),
});

// --- sponsorship offer ------------------------------------------------------

/**
 * An explicit offer to sell sponsorship. "Partner with us" alone is not one: generic
 * partner pages are common on every kind of site.
 */
const SPONSORSHIP_OFFER =
  /\b(become an? (official )?sponsor|sponsorship (packages?|opportunit(y|ies)|options|tiers|prospectus|proposals?|enquir(y|ies)|rates)|sponsor (our|the|a|an) (club|team|union|event|player|match|league|school|season|tournament|race|federation|athlete|stadium)|sponsor us)\b/i;
const SPONSORSHIP_OFFER_SEGMENT = /^(become-an?-sponsor|sponsorship-(packages?|opportunities|options|prospectus|tiers)|sponsor-us)$/;
const BARE_SPONSORSHIP = /^sponsorship$/i;

// --- procurement portal -----------------------------------------------------

/** Link or heading text that names the organisation's own tender or supply-chain process. */
const PORTAL_TEXT =
  /^((current|open|active|latest) )?(tenders?|bids)( (and|&) (quotations|notices|awards))?$|^tender (notices|bulletins?|documents|awards)$|^supply chain( management)?$|^(supplier|vendor) (registration|database|portal)$|^procurement( (notices|opportunities|portal))?$/i;
const PORTAL_SEGMENT = /^(tenders?|current-tenders|bids|scm|supply-chain(-management)?|procurement|(supplier|vendor)-(registration|portal|database))$/;

export const commercialChecks: CheckDefinition[] = [
  {
    key: "commercial.sponsorship_offer",
    name: "Sponsorship offered for sale",
    category: "commercial",
    severity: "info",
    version: V,
    description:
      "PRESENT for an explicit offer to sell sponsorship: a heading, link or button such as 'Sponsorship packages' or 'Become a sponsor', or a same-site page at /sponsorship-packages/. Prose alone is PRESENT at lower confidence. A bare 'Sponsorship' link is INDETERMINATE (it may thank existing sponsors); 'Partner with us' is not an offer. Evidence of commercial inventory, not of existing sponsors.",
    evidenceRecorded: "The heading, link or sentence that offers sponsorship.",
    confidences: {
      confidence_present_1: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the PRESENT result \"A sponsorship offer page is linked\"" },
      confidence_present_2: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the PRESENT result \"Sponsorship is offered for sale\"" },
      confidence_present_3: { default: 0.7, min: 0.1, max: 1, description: "Confidence of the PRESENT result \"Sponsorship is offered in the page text\"" },
      confidence_absent: { default: 0.75, min: 0.1, max: 1, description: "Confidence of the ABSENT result \"No sponsorship offer on the homepage\"" },
    },
    run({ doc }, cfg) {
      const els = visible(doc, ACTION_ELEMENTS);
      const byPath = els.find((el) => {
        const u = el.name === "a" ? resolveHref(doc, el.attribs?.href) : null;
        return !!u && sameSite(u, doc.url) && segments(u).some((s) => SPONSORSHIP_OFFER_SEGMENT.test(s));
      });
      if (byPath) return present("A sponsorship offer page is linked", conf(cfg, "confidence_present_1"), [elementEvidence(doc, byPath, "Sponsorship offer link")]);
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      const offer = els.find((el) => SPONSORSHIP_OFFER.test(textOf(doc.$, el)));
      if (offer) return present("Sponsorship is offered for sale", conf(cfg, "confidence_present_2"), [elementEvidence(doc, offer, "Sponsorship offer")]);
      const prose = doc.text.match(SPONSORSHIP_OFFER)?.[0];
      if (prose) return present("Sponsorship is offered in the page text", conf(cfg, "confidence_present_3"), [{ claim: "Sponsorship offer wording", value: prose, locator: "body text" }]);
      const bare = els.find((el) => {
        if (BARE_SPONSORSHIP.test(textOf(doc.$, el))) return true;
        const u = el.name === "a" ? resolveHref(doc, el.attribs?.href) : null;
        return !!u && sameSite(u, doc.url) && segments(u).includes("sponsorship");
      });
      if (bare) return indeterminate("A 'Sponsorship' page is linked but does not say it sells sponsorship, and was not read", [elementEvidence(doc, bare, "Sponsorship link")]);
      return absent("No sponsorship offer on the homepage", conf(cfg, "confidence_absent"), [{ claim: "No sponsorship offer matched", value: null, locator: "body" }]);
    },
  },
  {
    key: "commercial.procurement_portal",
    name: "Tender or supply-chain portal",
    category: "commercial",
    severity: "info",
    version: V,
    description:
      "PRESENT when the organisation publishes its own tender or supply-chain process: a link or heading named 'Tenders', 'Supply chain management', 'Supplier registration' or 'Procurement', or a same-site page at such a path. A path alone is lower confidence. Links to national portals (eTenders, CSD) are not counted: suppliers link to them too.",
    evidenceRecorded: "The tender or supply-chain link or heading.",
    confidences: {
      confidence_present_1: { default: 0.85, min: 0.1, max: 1, description: "Confidence of the PRESENT result \"The organisation publishes a tender or supply-chain process\"" },
      confidence_present_2: { default: 0.7, min: 0.1, max: 1, description: "Confidence of the PRESENT result \"A same-site tender or supply-chain page is linked\"" },
      confidence_absent: { default: 0.75, min: 0.1, max: 1, description: "Confidence of the ABSENT result \"No tender or supply-chain portal on the homepage\"" },
    },
    run({ doc }, cfg) {
      const els = visible(doc, ACTION_ELEMENTS);
      if (doc.vocabularyReliable) {
        const named = els.find((el) => PORTAL_TEXT.test(textOf(doc.$, el)) && (el.name !== "a" || (() => {
          const u = resolveHref(doc, el.attribs?.href);
          return !u || sameSite(u, doc.url);
        })()));
        if (named) return present("The organisation publishes a tender or supply-chain process", conf(cfg, "confidence_present_1"), [elementEvidence(doc, named, "Tender or supply-chain link")]);
      }
      const byPath = els.find((el) => {
        const u = el.name === "a" ? resolveHref(doc, el.attribs?.href) : null;
        return !!u && sameSite(u, doc.url) && segments(u).some((s) => PORTAL_SEGMENT.test(s));
      });
      if (byPath) return present("A same-site tender or supply-chain page is linked", conf(cfg, "confidence_present_2"), [elementEvidence(doc, byPath, "Tender or supply-chain path")]);
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      return absent("No tender or supply-chain portal on the homepage", conf(cfg, "confidence_absent"), [{ claim: "No procurement portal matched", value: null, locator: "body" }]);
    },
  },
];
