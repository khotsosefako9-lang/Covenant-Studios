import { describe, expect, it } from "vitest";
import { isAllowed, policyFor, policyFromFetch } from "@/core/robots";

const TOKEN = "CovenantStudiosBot";
const allowed = (txt: string, path: string) => isAllowed(policyFor(txt, TOKEN), path);

describe("robots.txt groups", () => {
  it("applies the wildcard group when no group names us", () => {
    const txt = "User-agent: *\nDisallow: /";
    expect(allowed(txt, "/")).toBe(false);
    expect(allowed(txt, "/about")).toBe(false);
  });

  it("prefers our own group over the wildcard group, case-insensitively", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: covenantstudiosbot\nAllow: /\n";
    expect(allowed(txt, "/")).toBe(true);
    expect(policyFor(txt, TOKEN).matchedAgent).toBe(TOKEN);
  });

  it("matches a group line carrying a version", () => {
    expect(allowed("User-agent: CovenantStudiosBot/1.0\nDisallow: /private", "/private/x")).toBe(false);
  });

  it("does not match another bot whose name merely starts like ours", () => {
    expect(allowed("User-agent: CovenantStudiosBotX\nDisallow: /\n", "/")).toBe(true);
  });

  it("merges several groups for the same agent and handles stacked user-agent lines", () => {
    const txt = "User-agent: googlebot\nUser-agent: CovenantStudiosBot\nDisallow: /a\n\nUser-agent: CovenantStudiosBot\nDisallow: /b\n";
    expect(allowed(txt, "/a")).toBe(false);
    expect(allowed(txt, "/b")).toBe(false);
    expect(allowed(txt, "/c")).toBe(true);
  });

  it("allows everything with no groups, an empty file or an empty Disallow", () => {
    expect(allowed("", "/")).toBe(true);
    expect(allowed("Sitemap: https://x.co.za/s.xml", "/")).toBe(true);
    expect(allowed("User-agent: *\nDisallow:", "/anything")).toBe(true);
  });

  it("ignores comments, unknown fields, blank lines and rules before any group", () => {
    const txt = "Disallow: /\n# comment\nUser-agent: * # everyone\n\nFoo: bar\nDisallow: /x # no x\n";
    expect(allowed(txt, "/")).toBe(true);
    expect(allowed(txt, "/x")).toBe(false);
  });

  it("handles CRLF line endings", () => {
    expect(allowed("User-agent: *\r\nDisallow: /\r\n", "/")).toBe(false);
  });
});

describe("robots.txt rule matching", () => {
  it.each([
    ["Disallow: /private", "/private", false],
    ["Disallow: /private", "/private/x", false],
    ["Disallow: /private", "/privateer", false],
    ["Disallow: /private/", "/private", true],
    ["Disallow: /*.pdf$", "/files/cat.pdf", false],
    ["Disallow: /*.pdf$", "/files/cat.pdf?x=1", true],
    ["Disallow: /*?", "/shop?id=1", false],
    ["Disallow: /*?", "/shop", true],
    ["Disallow: /a*b", "/axxb/c", false],
    ["Disallow: /%7Euser", "/~user/page", false],
  ])("%s → %s allowed=%s", (rule, path, expected) => {
    expect(allowed(`User-agent: *\n${rule}`, path)).toBe(expected);
  });

  it("lets the longest match win, with allow winning ties", () => {
    const txt = "User-agent: *\nDisallow: /shop\nAllow: /shop/public\nAllow: /x\nDisallow: /x";
    expect(allowed(txt, "/shop/cart")).toBe(false);
    expect(allowed(txt, "/shop/public/item")).toBe(true);
    expect(allowed(txt, "/x")).toBe(true);
  });

  it("always allows /robots.txt itself", () => {
    expect(allowed("User-agent: *\nDisallow: /", "/robots.txt")).toBe(true);
  });
});

describe("crawl-delay", () => {
  it("reads it from the matched group only", () => {
    expect(policyFor("User-agent: *\nCrawl-delay: 5\nDisallow:", TOKEN).crawlDelaySeconds).toBe(5);
    expect(policyFor("User-agent: other\nCrawl-delay: 9\n\nUser-agent: *\nDisallow:", TOKEN).crawlDelaySeconds).toBeNull();
    expect(policyFor("User-agent: *\nCrawl-delay: 1.5", TOKEN).crawlDelaySeconds).toBe(1.5);
    expect(policyFor("User-agent: *\nCrawl-delay: soon", TOKEN).crawlDelaySeconds).toBeNull();
  });
});

describe("policy from a robots.txt fetch result (RFC 9309 §2.3.1)", () => {
  it.each([
    [200, "User-agent: *\nDisallow: /", false],
    [200, "", true],
    [404, null, true],
    [410, null, true],
    [403, null, true],
    [429, null, false],
    [500, null, false],
    [503, null, false],
    [null, null, false],
  ])("status %s → page allowed=%s", (status, body, expected) => {
    expect(isAllowed(policyFromFetch(status, body, TOKEN), "/")).toBe(expected);
  });
});
