// Conversion checks: can a visitor act? Wording-based checks only judge English pages;
// structural signals (tel:, mailto:, WhatsApp links, forms) are language-neutral.
import type { Element } from "domhandler";
import { EMAIL, FIRST_SCREEN_CHARS, type PageDoc, SA_PHONE, excerptOf, pathOf, resolveHref, textOf, visible } from "../document";
import type { CheckDefinition, EvidenceItem } from "../types";
import { fail, indeterminate, notApplicable, notEnglish, pass } from "./result";

const V = "1";

const CTA_WORDS =
  /\b(get (a |your )?(free )?quotes?|request (a )?(quote|call ?back|callback|consultation|demo)|get in touch|contact us|call (us|now|today)|book( now| online| a| an| your)?|enquire|enquiry|inquire|get started|start (now|today)|shop( now)?|buy( now)?|order( now| online)?|sign up|register|subscribe|donate|apply( now)?|tickets?|whatsapp us|chat (with us|on whatsapp)|schedule|free (consultation|quote|trial|assessment)|let'?s talk|hire us|speak to|talk to (us|an?)|send (us )?(a )?message)\b/i;

const WHATSAPP_HOSTS = /^(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com)$/i;
const FORM_EMBEDS = /(docs\.google\.com\/forms|forms\.gle|typeform\.com|jotform\.com|hsforms\.(com|net)|share\.hsforms|cognitoforms\.com|formstack\.com|wufoo\.com|forms\.office\.com|tally\.so|paperform\.co|zoho\.com\/forms|calendly\.com)/i;
const FORM_SCRIPTS = /(js\.hsforms\.net|hbspt\.forms|embed\.typeform\.com|form\.jotform|static\.cognitoforms|tally\.so\/widgets)/i;

function hrefScheme(el: Element): string {
  return (el.attribs?.href ?? "").trim().toLowerCase();
}

function isWhatsApp(doc: PageDoc, el: Element): boolean {
  const href = hrefScheme(el);
  if (href.startsWith("whatsapp:")) return true;
  const u = resolveHref(doc, el.attribs?.href);
  return !!u && WHATSAPP_HOSTS.test(u.hostname);
}

function actionElements(doc: PageDoc): Element[] {
  return visible(doc, "a[href], button, input[type='submit' i], input[type='button' i], [role='button']");
}

function labelOf(doc: PageDoc, el: Element): string {
  const t = textOf(doc.$, el) || el.attribs?.value || el.attribs?.["aria-label"] || el.attribs?.title || "";
  return t.replace(/\s+/g, " ").trim();
}

/** Forms a visitor can use to make contact: not search, not login, not a lone newsletter field. */
export function enquiryForms(doc: PageDoc): Element[] {
  return visible(doc, "form").filter((f) => {
    const $f = doc.$(f);
    if ($f.attr("role") === "search" || $f.find("input[type='search' i]").length) return false;
    if ($f.find("input[type='password' i]").length) return false;
    const fields = $f.find("input, textarea, select").toArray().filter((x) => {
      const t = ((x as Element).attribs?.type ?? "text").toLowerCase();
      return !["hidden", "submit", "button", "image", "reset", "checkbox", "radio"].includes(t);
    }) as Element[];
    if (fields.length === 0) return false;
    const names = fields.map((x) => `${x.attribs?.name ?? ""} ${x.attribs?.id ?? ""}`.toLowerCase());
    if (fields.length === 1 && names.every((n) => /^\s*(q|s|query|search|keyword)s?\b/.test(n))) return false;
    // A single email field with no message box is a newsletter sign-up, not an enquiry form.
    if (fields.length === 1 && $f.find("textarea").length === 0 && /email/.test(`${names[0]} ${(fields[0] as Element).attribs?.type ?? ""}`)) return false;
    return true;
  });
}

function embeddedForms(doc: PageDoc): Element[] {
  return visible(doc, "iframe[src]").filter((el) => FORM_EMBEDS.test(el.attribs?.src ?? ""));
}

function requiredCount(doc: PageDoc, form: Element): number {
  return doc
    .$(form)
    .find("input, textarea, select")
    .toArray()
    .filter((x) => {
      const a = (x as Element).attribs ?? {};
      return ("required" in a || a["aria-required"] === "true") && !["hidden", "submit"].includes((a.type ?? "").toLowerCase());
    }).length;
}

export const conversionChecks: CheckDefinition[] = [
  {
    key: "conv.primary_cta_first_screen",
    name: "Call to action in the first screen",
    category: "conversion",
    severity: "medium",
    version: V,
    description: `PASS when an action link/button (quote, book, contact, call, shop, tel:/mailto:/WhatsApp) starts within the first ${FIRST_SCREEN_CHARS} characters of non-navigation text. Markup order, not rendered layout.`,
    evidenceRecorded: "The first action element found, its text, CSS path and text offset.",
    run({ doc }) {
      const actions = actionElements(doc).filter((el) => {
        const href = hrefScheme(el);
        return href.startsWith("tel:") || href.startsWith("mailto:") || isWhatsApp(doc, el) || (doc.vocabularyReliable && CTA_WORDS.test(labelOf(doc, el)));
      });
      const first = actions[0];
      const ev = (el: Element): EvidenceItem => ({
        claim: "Action element",
        value: labelOf(doc, el) || hrefScheme(el),
        excerpt: excerptOf(doc.$, el),
        locator: `${pathOf(el)} (text offset ${doc.offsets.get(el) ?? "?"})`,
      });
      if (first && (doc.offsets.get(first) ?? Infinity) < FIRST_SCREEN_CHARS) return pass("An action is offered at the top of the page", 0.75, [ev(first)]);
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      if (first) {
        return fail(`The first call to action appears ${doc.offsets.get(first)} characters into the page, not in the first screen`, 0.6, [ev(first)]);
      }
      return fail("No call-to-action link or button found on the page", 0.7, [{ claim: "No action link or button matched", value: null, locator: "body" }]);
    },
  },
  {
    key: "conv.contact_path",
    name: "Any contact path",
    category: "conversion",
    severity: "high",
    version: V,
    description: "PASS for any of: tel:, mailto: or WhatsApp link, enquiry form (incl. embedded), contact page link, or a phone number or email address in the text.",
    evidenceRecorded: "The first contact path found and its location, or the list of signals sought.",
    run({ doc }) {
      const links = visible(doc, "a[href]");
      const direct = links.find((el) => /^(tel:|mailto:)/.test(hrefScheme(el)) || isWhatsApp(doc, el));
      if (direct) return pass("A direct contact link is present", 0.97, [{ claim: "Contact link", value: hrefScheme(direct), excerpt: excerptOf(doc.$, direct), locator: pathOf(direct) }]);
      const form = enquiryForms(doc)[0] ?? embeddedForms(doc)[0];
      if (form) return pass("An enquiry form is present", 0.95, [{ claim: "Enquiry form", value: null, excerpt: excerptOf(doc.$, form), locator: pathOf(form) }]);
      const phone = doc.text.match(SA_PHONE)?.[0];
      const email = doc.text.match(EMAIL)?.[0];
      if (phone || email) return pass("Contact details appear in the page text", 0.9, [{ claim: "Contact details in text", value: phone ?? email ?? null, locator: "body text" }]);
      const contactPage = links.find((el) => /contact|kontak|contacto|nous-joindre/i.test(`${el.attribs?.href ?? ""} ${textOf(doc.$, el)}`));
      if (contactPage) return pass("A contact page is linked", 0.85, [{ claim: "Contact page link", value: contactPage.attribs?.href ?? null, locator: pathOf(contactPage) }]);
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      return fail("No way to contact the business was found on the homepage", 0.85, [
        { claim: "No tel:, mailto:, WhatsApp link, enquiry form, contact page link, phone number or email address", value: null, locator: "body" },
      ]);
    },
  },
  {
    key: "conv.click_to_call",
    name: "Click-to-call link",
    category: "conversion",
    severity: "medium",
    version: V,
    description: "PASS with a tel: link. FAIL only when a phone number appears as plain text outside any link (a number that is itself a link, e.g. to WhatsApp, is tappable). NOT_APPLICABLE when no phone number is published.",
    evidenceRecorded: "The tel: link, or the plain-text phone number.",
    run({ doc }) {
      const tel = visible(doc, "a[href]").find((el) => hrefScheme(el).startsWith("tel:"));
      if (tel) return pass("Phone number is tappable", 0.97, [{ claim: "tel: link", value: hrefScheme(tel), locator: pathOf(tel) }]);
      const phone = doc.unlinkedText.match(SA_PHONE)?.[0];
      if (!phone) {
        return doc.text.match(SA_PHONE)
          ? pass("The phone number shown is a tappable link", 0.85)
          : notApplicable("No phone number is published on the page");
      }
      return fail("A phone number is shown but cannot be tapped to call", 0.9, [{ claim: "Phone number shown as plain text", value: phone, locator: "body text" }]);
    },
  },
  {
    key: "conv.whatsapp_link",
    name: "WhatsApp link",
    category: "conversion",
    severity: "info",
    version: V,
    description: "PASS for a wa.me / api.whatsapp.com / whatsapp: link.",
    evidenceRecorded: "The WhatsApp link, or its absence.",
    run({ doc }) {
      const wa = visible(doc, "a[href]").find((el) => isWhatsApp(doc, el));
      if (wa) return pass("WhatsApp link present", 0.97, [{ claim: "WhatsApp link", value: wa.attribs?.href ?? null, locator: pathOf(wa) }]);
      return fail("No WhatsApp link", 0.9, [{ claim: "No WhatsApp link on the page", value: null, locator: "body" }]);
    },
  },
  {
    key: "conv.enquiry_form",
    name: "Enquiry form",
    category: "conversion",
    severity: "low",
    version: V,
    description: "PASS for an on-page enquiry form or a known embedded form provider. INDETERMINATE when only a form-provider script is present.",
    evidenceRecorded: "The form element or embed, and its location.",
    run({ doc }) {
      const form = enquiryForms(doc)[0];
      if (form) return pass("Enquiry form on the page", 0.95, [{ claim: "Enquiry form", value: null, excerpt: excerptOf(doc.$, form), locator: pathOf(form) }]);
      const embed = embeddedForms(doc)[0];
      if (embed) return pass("Embedded enquiry form", 0.85, [{ claim: "Embedded form", value: embed.attribs?.src ?? null, locator: pathOf(embed) }]);
      const script = doc.$("script[src]").toArray().find((s) => FORM_SCRIPTS.test((s as Element).attribs?.src ?? "")) as Element | undefined;
      if (script) return indeterminate("A form provider script is loaded; the form itself is rendered by JavaScript", [{ claim: "Form provider script", value: script.attribs?.src ?? null, locator: pathOf(script) }]);
      // The homepage was the only page read. A linked contact page may well hold the form.
      const contactPage = visible(doc, "a[href]").find((el) => /contact|kontak|enquir|quote|kwotasie/i.test(`${el.attribs?.href ?? ""} ${textOf(doc.$, el)}`));
      if (contactPage) {
        return indeterminate("No form on the homepage, but a contact page is linked and was not read", [{ claim: "Contact page link", value: contactPage.attribs?.href ?? null, locator: pathOf(contactPage) }]);
      }
      return fail("No enquiry form on the homepage", 0.85, [{ claim: "No enquiry form", value: null, locator: "body" }]);
    },
  },
  {
    key: "conv.form_required_fields",
    name: "Enquiry form required fields",
    category: "conversion",
    severity: "medium",
    version: V,
    description: "Counts fields marked required (required / aria-required) in the first enquiry form; FAIL above 6.",
    evidenceRecorded: "The required-field count and the form's location.",
    run({ doc }) {
      const form = enquiryForms(doc)[0];
      if (!form) return embeddedForms(doc).length ? indeterminate("The form is embedded from another site; its fields cannot be read") : notApplicable("No enquiry form");
      const n = requiredCount(doc, form);
      const ev = [{ claim: "Required fields in the enquiry form", value: String(n), locator: pathOf(form) }];
      if (n > 6) return fail(`The enquiry form requires ${n} fields`, 0.85, ev);
      return pass(`The enquiry form requires ${n} field(s)`, 0.8, ev);
    },
  },
  {
    key: "conv.form_position",
    name: "Enquiry form position",
    category: "conversion",
    severity: "low",
    version: V,
    description: "Text offset of the first enquiry form; FAIL beyond 2,500 characters. Markup order only, so confidence is moderate.",
    evidenceRecorded: "The form's text offset and location.",
    run({ doc }) {
      const form = enquiryForms(doc)[0];
      if (!form) return notApplicable("No enquiry form");
      const off = doc.offsets.get(form) ?? 0;
      const ev = [{ claim: "Enquiry form text offset", value: String(off), locator: pathOf(form) }];
      if (off > 2500) return fail(`The enquiry form starts ${off} characters into the page`, 0.5, ev);
      return pass("The enquiry form is near the top of the page", 0.5, ev);
    },
  },
  {
    key: "conv.trust_signals",
    name: "Trust signals",
    category: "conversion",
    severity: "low",
    version: V,
    description: "PASS for testimonials, reviews, ratings, client logos/'trusted by', accreditations, or review-provider embeds/structured data.",
    evidenceRecorded: "The first trust signal found.",
    run({ doc }) {
      const ld = doc.$("script[type='application/ld+json']").text();
      if (/"(AggregateRating|Review)"/.test(ld)) return pass("Review structured data present", 0.9, [{ claim: "Review structured data", value: null, locator: "script[type=application/ld+json]" }]);
      const widget = doc.$("iframe[src], script[src], div[class]").toArray().find((el) => /trustpilot|hellopeter|elfsight|google.*review|reviews\.io|yotpo/i.test(`${(el as Element).attribs?.src ?? ""} ${(el as Element).attribs?.class ?? ""}`)) as Element | undefined;
      if (widget) return pass("Review widget present", 0.85, [{ claim: "Review widget", value: widget.attribs?.src ?? widget.attribs?.class ?? null, locator: pathOf(widget) }]);
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      const m = doc.text.match(/\b(testimonials?|reviews?|what (our )?(clients|customers) say|trusted by|our clients|clients include|case stud(y|ies)|accredit\w*|certified|registered with|members? of|admitted (as|to)|rated \d|5[- ]star|★)/i);
      if (m) return pass("Trust signals appear on the page", 0.8, [{ claim: "Trust wording", value: m[0], locator: "body text" }]);
      return fail("No testimonials, reviews, client logos or accreditations found", 0.65, [{ claim: "No trust signal matched", value: null, locator: "body" }]);
    },
  },
  {
    key: "conv.services_named",
    name: "Services named on the homepage",
    category: "conversion",
    severity: "low",
    version: V,
    description: "PASS when the page names what the business offers. FAIL only for a thin page (under 150 words, at most one heading); otherwise INDETERMINATE.",
    evidenceRecorded: "The heading or phrase that names the offer.",
    run({ doc }) {
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      const headings = visible(doc, "h1, h2, h3, nav a");
      const hit = headings.find((h) => /\b(services?|what we do|products?|solutions?|our work|specialis|specializ|we offer|we provide)\b/i.test(textOf(doc.$, h)));
      if (hit) return pass("The page names its services or products", 0.8, [{ claim: "Offer heading or menu item", value: textOf(doc.$, hit), locator: pathOf(hit) }]);
      const phrase = doc.text.match(/\b(we (offer|provide|specialise in|specialize in|supply|install|repair|build|design)|our (services|products|range))\b/i)?.[0];
      if (phrase) return pass("The page describes what it offers", 0.7, [{ claim: "Offer phrase", value: phrase, locator: "body text" }]);
      const headingCount = visible(doc, "h1, h2, h3").length;
      if (doc.wordCount < 150 && headingCount <= 1) {
        return fail(`The homepage has ${doc.wordCount} words and does not say what the business offers`, 0.6, [{ claim: "Word and heading count", value: `${doc.wordCount} words, ${headingCount} heading(s)`, locator: "body" }]);
      }
      return indeterminate("No services heading or phrase matched, but the page has enough content that the offer may be described in other words");
    },
  },
  {
    key: "conv.pricing_info",
    name: "Pricing information",
    category: "conversion",
    severity: "info",
    version: V,
    description: "PASS for rand amounts, ZAR, 'from R…', per-month/hour prices or a pricing/rates/packages section.",
    evidenceRecorded: "The first price or pricing wording found.",
    run({ doc }) {
      const amount = doc.text.match(/\bR\s?\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d{2})?\b|\bZAR\s?\d/)?.[0];
      if (amount) return pass("Prices are shown", 0.85, [{ claim: "Price on page", value: amount, locator: "body text" }]);
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      const word = doc.text.match(/\b(pricing|price list|our rates|packages|per (month|hour|day)|call-out fee|from R)\b/i)?.[0];
      if (word) return pass("Pricing is referred to", 0.7, [{ claim: "Pricing wording", value: word, locator: "body text" }]);
      return fail("No prices or pricing information on the homepage", 0.75, [{ claim: "No price or pricing wording", value: null, locator: "body" }]);
    },
  },
];
