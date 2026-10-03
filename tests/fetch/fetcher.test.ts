import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type FetchConfig, FetchRun, loadFetchConfig } from "@/fetch/fetcher";
import { ROBOTS_TOKEN, USER_AGENT } from "@/fetch/identity";
import { HostLimiter } from "@/fetch/limiter";
import { adminUrl, createTestDb } from "../db/harness";
import { FakeClock, type Fixture, html, robots, serve, serveSelfSignedTls, status } from "./fixture";

let pool: Pool;
let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let teardown: () => Promise<void>;
let baseConfig: FetchConfig;
const open: { close(): Promise<void> }[] = [];

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  (await pool.query(text, params)).rows as T[];
const recordOf = async (id: string) =>
  (
    await q<{
      fetch_outcome: string;
      http_status: number | null;
      purpose: string;
      host: string;
      user_agent: string;
      attempts: number | null;
      redirect_chain: string[] | null;
      robots_source_record_id: string | null;
      raw_content: string | null;
      error_detail: string | null;
      final_url: string;
      revalidated_from_id: string | null;
      content_hash: string | null;
    }>(`select * from source_records where id = $1`, [id])
  )[0];

async function fixture(routes: Parameters<typeof serve>[0], fallback?: Parameters<typeof serve>[1]): Promise<Fixture> {
  const f = await serve(routes, fallback);
  open.push(f);
  return f;
}

function newRun(overrides: Partial<FetchConfig> = {}, clock = new FakeClock()) {
  const run = new FetchRun(db, { ...baseConfig, ...overrides }, new HostLimiter(clock), clock);
  open.push(run);
  return { run, clock };
}

const pagePaths = (f: Fixture) => f.requests.map((r) => r.path).filter((p) => p !== "/robots.txt");

describe.skipIf(!adminUrl)("fetch layer against local fixture servers", () => {
  beforeAll(async () => {
    const t = await createTestDb();
    pool = t.pool;
    db = t.db;
    teardown = t.drop;
    baseConfig = await loadFetchConfig(db);
  }, 60_000);

  afterEach(async () => {
    await Promise.all(open.splice(0).map((x) => x.close()));
    await pool.query(`update settings set value = 'false' where key = 'fetch_paused'`);
  });

  afterAll(async () => {
    await teardown?.();
  });

  describe("identity and politeness", () => {
    it("identifies itself honestly on every request", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /"), "/": html("hi") });
      const { run } = newRun();
      const r = await run.fetchPage(`${f.origin}/`);
      expect(r).toMatchObject({ recorded: true, outcome: "OK", httpStatus: 200 });
      expect(f.requests.map((x) => x.userAgent)).toEqual([USER_AGENT, USER_AGENT]);
      expect(USER_AGENT).toMatch(/^CovenantStudiosBot\/\S+ \(\+https:\/\/www\.covenant-studios\.co\.za\)$/);
      if (r.recorded) expect((await recordOf(r.sourceRecordId))?.user_agent).toBe(USER_AGENT);
    });

    it("stores robots.txt as its own source record and links each page fetch to it", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nDisallow: /private"), "/": html("hi") });
      const { run } = newRun();
      const r = await run.fetchPage(`${f.origin}/`);
      if (!r.recorded) throw new Error("expected a record");
      const page = await recordOf(r.sourceRecordId);
      const rob = await recordOf(page?.robots_source_record_id as string);
      expect(rob).toMatchObject({ purpose: "robots", fetch_outcome: "OK", http_status: 200, raw_content: "User-agent: *\nDisallow: /private" });
    });

    it("waits at least 2 seconds between requests to one host, and longer when crawl-delay says so", async () => {
      const plain = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, html("x"));
      const a = newRun();
      await a.run.fetchPage(`${plain.origin}/one`);
      await a.run.fetchPage(`${plain.origin}/two`);
      expect(a.clock.sleeps).toEqual([2000, 2000]);

      const slow = await fixture({ "/robots.txt": robots("User-agent: *\nCrawl-delay: 7\nAllow: /") }, html("x"));
      const b = newRun();
      await b.run.fetchPage(`${slow.origin}/one`);
      await b.run.fetchPage(`${slow.origin}/two`);
      // robots → page uses the 2s floor (crawl-delay not known yet); page → page uses 7s.
      expect(b.clock.sleeps).toEqual([2000, 7000]);
    });

    it("never has more than one request in flight to a host", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, async (_req, res) => {
        await new Promise((r) => setTimeout(r, 50));
        html("x")(_req, res);
      });
      const { run } = newRun();
      await Promise.all(["/a", "/b", "/c", "/d"].map((p) => run.fetchPage(`${f.origin}${p}`)));
      expect(f.maxInFlight).toBe(1);
      expect(pagePaths(f).sort()).toEqual(["/a", "/b", "/c", "/d"]);
    });

    it("stops at the per-host request budget for the run", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, html("x"));
      const { run } = newRun({ hostBudgetPerRun: 3 });
      expect((await run.fetchPage(`${f.origin}/1`)).recorded).toBe(true);
      expect((await run.fetchPage(`${f.origin}/2`)).recorded).toBe(true);
      expect(await run.fetchPage(`${f.origin}/3`)).toMatchObject({ recorded: false, reason: "budget_exhausted" });
      expect(f.requests).toHaveLength(3);
    });

    it("halts all fetching when the global pause switch is on", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, html("x"));
      await pool.query(`update settings set value = 'true' where key = 'fetch_paused'`);
      const { run } = newRun();
      expect(await run.fetchPage(`${f.origin}/`)).toMatchObject({ recorded: false, reason: "paused" });
      expect(f.requests).toHaveLength(0);
    });
  });

  describe("robots.txt", () => {
    it("records SOURCE_BLOCKED without requesting the page, and never retries it", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nDisallow: /") }, html("secret"));
      const { run } = newRun();
      const r = await run.fetchPage(`${f.origin}/`);
      expect(r).toMatchObject({ recorded: true, outcome: "SOURCE_BLOCKED", httpStatus: null });
      const again = await run.fetchPage(`${f.origin}/`);
      expect(again).toMatchObject({ recorded: true, outcome: "SOURCE_BLOCKED" });
      expect(f.requests.map((x) => x.path)).toEqual(["/robots.txt"]);
      if (r.recorded) {
        const rec = await recordOf(r.sourceRecordId);
        expect(rec).toMatchObject({ http_status: null, raw_content: null, attempts: 0 });
        expect(rec?.robots_source_record_id).toBeTruthy();
        expect(rec?.error_detail).toContain(ROBOTS_TOKEN);
      }
    });

    it("obeys rules addressed to our product token", async () => {
      const f = await fixture(
        { "/robots.txt": robots(`User-agent: *\nAllow: /\n\nUser-agent: ${ROBOTS_TOKEN}\nDisallow: /shop`) },
        html("x"),
      );
      const { run } = newRun();
      expect(await run.fetchPage(`${f.origin}/shop/item`)).toMatchObject({ outcome: "SOURCE_BLOCKED" });
      expect(await run.fetchPage(`${f.origin}/about`)).toMatchObject({ outcome: "OK" });
      expect(pagePaths(f)).toEqual(["/about"]);
    });

    it("treats a 5xx robots.txt as complete disallow and a 404 robots.txt as allow", async () => {
      const down = await fixture({ "/robots.txt": status(503) }, html("x"));
      const a = newRun();
      expect(await a.run.fetchPage(`${down.origin}/`)).toMatchObject({ outcome: "SOURCE_BLOCKED" });
      expect(pagePaths(down)).toEqual([]);

      const missing = await fixture({ "/": html("x") });
      const b = newRun();
      expect(await b.run.fetchPage(`${missing.origin}/`)).toMatchObject({ outcome: "OK" });
    });

    it("checks robots.txt on every host in a redirect chain", async () => {
      const other = await fixture({ "/robots.txt": robots("User-agent: *\nDisallow: /") }, html("x"));
      const f = await fixture({
        "/robots.txt": robots("User-agent: *\nAllow: /"),
        "/go": status(302, { location: `${other.origin}/landing` }),
      });
      const { run } = newRun();
      const r = await run.fetchPage(`${f.origin}/go`);
      expect(r).toMatchObject({ outcome: "SOURCE_BLOCKED", finalUrl: `${other.origin}/landing` });
      expect(other.requests.map((x) => x.path)).toEqual(["/robots.txt"]);
    });

    it("reuses a stored robots.txt within its TTL across runs", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, html("x"));
      await newRun().run.fetchPage(`${f.origin}/a`);
      await newRun().run.fetchPage(`${f.origin}/b`);
      expect(f.requests.filter((r) => r.path === "/robots.txt")).toHaveLength(1);
    });
  });

  describe("server responses", () => {
    it("records 403 as BLOCKED_BY_SERVER with no retry", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /"), "/": status(403) });
      const r = await newRun().run.fetchPage(`${f.origin}/`);
      expect(r).toMatchObject({ outcome: "BLOCKED_BY_SERVER", httpStatus: 403 });
      expect(pagePaths(f)).toEqual(["/"]);
    });

    it("records 429 as BLOCKED_BY_SERVER and honours Retry-After before the next request to that host", async () => {
      const f = await fixture(
        { "/robots.txt": robots("User-agent: *\nAllow: /"), "/busy": status(429, { "retry-after": "120" }) },
        html("x"),
      );
      const { run, clock } = newRun();
      const r = await run.fetchPage(`${f.origin}/busy`);
      expect(r).toMatchObject({ outcome: "BLOCKED_BY_SERVER", httpStatus: 429 });
      clock.sleeps = [];
      await run.fetchPage(`${f.origin}/next`);
      expect(clock.sleeps[0]).toBeGreaterThanOrEqual(120_000);
      expect(pagePaths(f)).toEqual(["/busy", "/next"]);
    });

    it("retries transient 5xx with exponential backoff, at most 3 times", async () => {
      let n = 0;
      const flaky = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, (req, res) =>
        ++n < 3 ? status(503)(req, res) : html("ok")(req, res),
      );
      const a = newRun();
      const ok = await a.run.fetchPage(`${flaky.origin}/`);
      expect(ok).toMatchObject({ outcome: "OK" });
      if (ok.recorded) expect((await recordOf(ok.sourceRecordId))?.attempts).toBe(3);
      // 2s gap after robots.txt, then backoff of 2x and 4x the 2s gap before the two retries.
      expect(a.clock.sleeps).toEqual([2000, 4000, 8000]);

      const dead = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /"), "/": status(500) });
      const b = newRun();
      const r = await b.run.fetchPage(`${dead.origin}/`);
      expect(r).toMatchObject({ outcome: "HTTP_ERROR", httpStatus: 500 });
      expect(pagePaths(dead)).toHaveLength(4);
      if (r.recorded) expect((await recordOf(r.sourceRecordId))?.attempts).toBe(4);
    });

    it("follows redirects and records the chain", async () => {
      const f = await fixture({
        "/robots.txt": robots("User-agent: *\nAllow: /"),
        "/old": status(301, { location: "/new" }),
        "/new": html("moved"),
      });
      const r = await newRun().run.fetchPage(`${f.origin}/old`);
      expect(r).toMatchObject({ outcome: "OK", finalUrl: `${f.origin}/new` });
      if (r.recorded) expect((await recordOf(r.sourceRecordId))?.redirect_chain).toEqual([`${f.origin}/old`, `${f.origin}/new`]);
    });

    it("detects redirect loops and enforces the hop cap", async () => {
      const f = await fixture({
        "/robots.txt": robots("User-agent: *\nAllow: /"),
        "/a": status(302, { location: "/b" }),
        "/b": status(302, { location: "/a" }),
      }, (req, res) => {
        const n = Number(req.url?.slice(2));
        status(302, { location: `/r${n + 1}` })(req, res);
      });
      const { run } = newRun();
      const loop = await run.fetchPage(`${f.origin}/a`);
      expect(loop).toMatchObject({ outcome: "REDIRECT_LOOP" });
      if (loop.recorded) expect((await recordOf(loop.sourceRecordId))?.error_detail).toContain("loop");
      const long = await run.fetchPage(`${f.origin}/r1`);
      expect(long).toMatchObject({ outcome: "REDIRECT_LOOP" });
      if (long.recorded) expect((await recordOf(long.sourceRecordId))?.error_detail).toContain("More than 5 redirects");
      expect(pagePaths(f).filter((p) => p.startsWith("/r"))).toHaveLength(6);
    });

    it("times out a slow response", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, async (_req, res) => {
        await new Promise((r) => setTimeout(r, 1500));
        html("late")(_req, res);
      });
      const r = await newRun({ readTimeoutMs: 200, maxRetries: 1 }).run.fetchPage(`${f.origin}/`);
      expect(r).toMatchObject({ outcome: "TIMEOUT", httpStatus: null });
      if (r.recorded) expect((await recordOf(r.sourceRecordId))?.attempts).toBe(2);
    });

    it("refuses an oversized body declared up front without downloading it", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, (_req, res) => {
        res.writeHead(200, { "content-type": "text/html", "content-length": String(40_000_000) });
        res.write("<html>");
        // never finishes: the client must not wait for 40 MB
      });
      const r = await newRun().run.fetchPage(`${f.origin}/`);
      expect(r).toMatchObject({ outcome: "TOO_LARGE" });
    });

    it("aborts a streamed body that grows past the limit", async () => {
      let sent = 0;
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        const chunk = "x".repeat(64 * 1024);
        const pump = () => {
          while (sent < 50_000_000) {
            sent += chunk.length;
            if (!res.write(chunk)) return void res.once("drain", pump);
          }
          res.end();
        };
        res.on("close", () => (sent = Number.POSITIVE_INFINITY));
        pump();
      });
      const r = await newRun({ maxBodyBytes: 1_000_000 }).run.fetchPage(`${f.origin}/`);
      expect(r).toMatchObject({ outcome: "TOO_LARGE" });
      if (r.recorded) {
        const rec = await recordOf(r.sourceRecordId);
        expect(rec?.raw_content).toBeNull();
        expect(rec?.error_detail).toContain("aborted");
      }
    });

    it("records a non-HTML content type without reading the body", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, (_req, res) => {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end("%PDF-1.7");
      });
      const r = await newRun().run.fetchPage(`${f.origin}/catalogue.pdf`);
      expect(r).toMatchObject({ outcome: "UNSUPPORTED_CONTENT_TYPE", httpStatus: 200 });
      if (r.recorded) expect((await recordOf(r.sourceRecordId))?.raw_content).toBeNull();
    });

    it("records a TLS failure and does not retry it or relax verification", async () => {
      const f = await serveSelfSignedTls({ "/robots.txt": robots("User-agent: *\nAllow: /"), "/": html("x") });
      open.push(f);
      const r = await newRun().run.fetchPage(`${f.origin}/`);
      expect(r).toMatchObject({ outcome: "TLS_ERROR", httpStatus: null });
      expect(f.requests).toHaveLength(0);
      if (r.recorded) {
        const page = await recordOf(r.sourceRecordId);
        const rob = await recordOf(page?.robots_source_record_id as string);
        expect(rob).toMatchObject({ fetch_outcome: "TLS_ERROR", attempts: 1 });
      }
    });

    it("records an unreachable host", async () => {
      const f = await fixture({});
      const origin = f.origin;
      await f.close();
      const r = await newRun({ maxRetries: 1 }).run.fetchPage(`${origin}/`);
      expect(r).toMatchObject({ outcome: "UNREACHABLE" });
    });
  });

  describe("caching", () => {
    it("serves a fresh page from its stored record, then revalidates with a conditional request", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, (req, res) => {
        if (req.headers["if-none-match"] === '"v1"') return status(304, { etag: '"v1"' })(req, res);
        html("content", { etag: '"v1"' })(req, res);
      });
      const clock = new FakeClock();
      const first = await newRun({}, clock).run.fetchPage(`${f.origin}/page`);
      if (!first.recorded) throw new Error("expected a record");

      const cached = await newRun({}, clock).run.fetchPage(`${f.origin}/page`);
      expect(cached).toEqual({ recorded: false, reason: "cached", sourceRecordId: first.sourceRecordId, outcome: "OK" });

      clock.advance(25 * 3_600_000);
      const again = await newRun({}, clock).run.fetchPage(`${f.origin}/page`);
      expect(again).toMatchObject({ recorded: true, outcome: "OK", httpStatus: 304, unchanged: true });
      if (again.recorded) {
        const rec = await recordOf(again.sourceRecordId);
        expect(rec?.revalidated_from_id).toBe(first.sourceRecordId);
        expect(rec?.raw_content).toBeNull();
        expect(rec?.content_hash).toBe((await recordOf(first.sourceRecordId))?.content_hash);
      }
      expect(f.requests.filter((r) => r.path === "/page").map((r) => r.headers["if-none-match"] ?? null)).toEqual([null, '"v1"']);
    });

    it("marks a re-fetched page with identical content as unchanged", async () => {
      const f = await fixture({ "/robots.txt": robots("User-agent: *\nAllow: /") }, html("same"));
      const clock = new FakeClock();
      await newRun({}, clock).run.fetchPage(`${f.origin}/p`);
      clock.advance(25 * 3_600_000);
      expect(await newRun({}, clock).run.fetchPage(`${f.origin}/p`)).toMatchObject({ outcome: "OK", httpStatus: 200, unchanged: true });
    });
  });
});
