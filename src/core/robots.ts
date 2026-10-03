// robots.txt parsing and matching per RFC 9309, plus Crawl-delay (non-standard but
// widely used; we honour it as a minimum delay). Pure: no I/O.

export const ROBOTS_MAX_BYTES = 500 * 1024; // RFC 9309 §2.5: parse at least 500 KiB

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  /** Which group applied: our product token, "*", or none (no matching group → allow all). */
  matchedAgent: string | null;
  rules: RobotsRule[];
  /** Crawl-delay in seconds from the matched group, if any. */
  crawlDelaySeconds: number | null;
}

interface Group {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.slice(0, ROBOTS_MAX_BYTES).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = (m[1] as string).toLowerCase();
    const value = (m[2] as string).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue; // rules before any user-agent line belong to no group
    if (field === "allow" || field === "disallow") {
      // An empty Disallow means "nothing disallowed": it adds no rule.
      if (value !== "") current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySeconds = Math.max(current.crawlDelaySeconds ?? 0, n);
    }
  }
  return groups;
}

/** A group line matches our product token case-insensitively; "Bot/1.0" matches token "bot". */
function agentMatches(groupAgent: string, token: string): boolean {
  const name = groupAgent.split(/[\s/]/)[0] ?? "";
  return name === token;
}

/** The policy that applies to `productToken`: its own groups merged, else "*", else allow all. */
export function policyFor(text: string, productToken: string): RobotsPolicy {
  const token = productToken.toLowerCase();
  const groups = parseGroups(text);
  const pick = (pred: (a: string) => boolean) => groups.filter((g) => g.agents.some(pred));
  let matched = pick((a) => agentMatches(a, token));
  let matchedAgent: string | null = productToken;
  if (matched.length === 0) {
    matched = pick((a) => a === "*");
    matchedAgent = matched.length ? "*" : null;
  }
  const delays = matched.map((g) => g.crawlDelaySeconds).filter((d): d is number => d !== null);
  return {
    matchedAgent,
    rules: matched.flatMap((g) => g.rules),
    crawlDelaySeconds: delays.length ? Math.max(...delays) : null,
  };
}

const DISALLOW_ALL: RobotsPolicy = { matchedAgent: "*", rules: [{ allow: false, pattern: "/" }], crawlDelaySeconds: null };
const ALLOW_ALL: RobotsPolicy = { matchedAgent: null, rules: [], crawlDelaySeconds: null };

/**
 * What a robots.txt fetch result means (RFC 9309 §2.3.1):
 * - 2xx: parse it.
 * - 4xx other than 429: robots.txt is "unavailable"; access is allowed.
 * - 429, 5xx or no response at all: "unreachable"; assume complete disallow.
 */
export function policyFromFetch(status: number | null, body: string | null, productToken: string): RobotsPolicy {
  if (status === null) return DISALLOW_ALL;
  if (status >= 200 && status < 300) return policyFor(body ?? "", productToken);
  if (status === 429 || status >= 500) return DISALLOW_ALL;
  if (status >= 400) return ALLOW_ALL;
  return DISALLOW_ALL; // unresolved redirects or anything unexpected: be conservative
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Pattern → regex: "*" matches any sequence, a trailing "$" anchors the end. */
function matchLength(pattern: string, path: string): number {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    `^${body
      .split("*")
      .map((part) => decodeSafe(part).replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}${anchored ? "$" : ""}`,
  );
  return re.test(path) ? pattern.length : -1;
}

/**
 * Whether `pathWithQuery` (e.g. "/shop?id=2") may be fetched. Longest matching pattern
 * wins; on a tie, allow wins. /robots.txt itself is always allowed.
 */
export function isAllowed(policy: RobotsPolicy, pathWithQuery: string): boolean {
  const path = decodeSafe(pathWithQuery || "/");
  if (path === "/robots.txt") return true;
  let best = -1;
  let allow = true;
  for (const rule of policy.rules) {
    const len = matchLength(rule.pattern, path);
    if (len > best || (len === best && rule.allow)) {
      best = len;
      allow = rule.allow;
    }
  }
  return allow;
}
