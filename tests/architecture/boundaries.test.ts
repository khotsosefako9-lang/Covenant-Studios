// Static checks on the source tree for rules that would otherwise fail quietly.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const src = files("src").map((p) => ({ path: relative(".", p), text: readFileSync(p, "utf8") }));

// Code only: comments may (and do) name the techniques that are forbidden.
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("company-scoped reads go through the identity cluster", () => {
  // Filtering a company-scoped table by one company id misses rows owned by companies
  // merged into it. Only identity code, which deals in individual records, may do so.
  const ALLOWED = new Set(["src/db/company-scope.ts", "src/identity/resolution.ts"]);

  it("has no direct eq(<table>.companyId, …) filter outside the allowlist", () => {
    const offenders = src
      .filter((f) => !ALLOWED.has(f.path) && !f.path.startsWith("src/db/schema/"))
      .flatMap((f) =>
        f.text
          .split("\n")
          .map((line, i) => ({ line, n: i + 1 }))
          .filter(({ line }) => /(eq|inArray)\(\s*s\.(?!companyRoots\b)\w+\.companyId\b/.test(line))
          .map(({ n }) => `${f.path}:${n}`),
      );
    expect(offenders).toEqual([]);
  });
});

describe("only the fetch layer talks to prospect infrastructure", () => {
  const NETWORK = [
    /from\s+["']undici["']/,
    /from\s+["']node:(http|https|net|tls|dgram)["']/,
    /\bfetch\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
  ];

  it("has no network client outside src/fetch", () => {
    const offenders = src
      .filter((f) => !f.path.startsWith("src/fetch/"))
      .filter((f) => NETWORK.some((re) => re.test(f.text)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("no evasion code anywhere in the repository", () => {
  // Disguise and block-circumvention techniques. Not configurable, not behind a flag.
  const FORBIDDEN: [string, RegExp][] = [
    ["browser user-agent string", /Mozilla\/5\.0|AppleWebKit|Chrome\/\d|Safari\/\d|Gecko\/\d/],
    ["proxy agent", /\b(ProxyAgent|EnvHttpProxyAgent|SocksProxyAgent|HttpsProxyAgent|socks[45]?:\/\/)/i],
    ["headless browser", /\b(puppeteer|playwright|selenium|chromium)\b/i],
    ["captcha handling", /captcha/i],
    ["TLS verification disabled", /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/],
    ["user-agent rotation", /(user.?agents?\s*[:=]\s*\[|rotateUserAgent|randomUserAgent)/i],
  ];

  it("still catches forbidden code once comments are stripped", () => {
    const code = stripComments(`// captcha is mentioned here only\nconst solver = "captcha"; /* Mozilla/5.0 */`);
    expect(FORBIDDEN.filter(([, re]) => re.test(code)).map(([label]) => label)).toEqual(["captcha handling"]);
    expect(stripComments('const u = "https://x.co.za/a"; // note')).toBe('const u = "https://x.co.za/a"; ');
  });

  it.each(FORBIDDEN)("src contains no %s", (_label, re) => {
    expect(src.filter((f) => re.test(stripComments(f.text))).map((f) => f.path)).toEqual([]);
  });
});
