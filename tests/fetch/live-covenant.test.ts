// Acceptance test against a real host. Covenant's own site disallows automated access in
// its robots.txt, so the fetch layer must record SOURCE_BLOCKED having requested only
// robots.txt, never the page. Opt-in (FETCH_LIVE=1) because it needs outbound network.
import { Agent, type Dispatcher, EnvHttpProxyAgent } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FetchRun, loadFetchConfig } from "@/fetch/fetcher";
import { HostLimiter, realClock } from "@/fetch/limiter";
import { adminUrl, createTestDb } from "../db/harness";

const live = process.env.FETCH_LIVE === "1";

describe.skipIf(!live || !adminUrl)("live: covenant-studios.co.za is refused by its own robots.txt", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  const seen: string[] = [];
  let dispatcher: Dispatcher;

  beforeAll(async () => {
    t = await createTestDb();
    // Test-only transport: a sandbox whose network policy routes egress through a fixed
    // proxy needs it to connect at all. It does not change our identity: the User-Agent,
    // robots handling and limits are the fetch layer's own. Production uses a plain Agent.
    const base = process.env.HTTPS_PROXY ? new EnvHttpProxyAgent() : new Agent();
    dispatcher = base.compose((dispatch) => (opts, handler) => {
      seen.push(`${opts.origin}${opts.path}`);
      return dispatch(opts, handler);
    });
  }, 60_000);

  afterAll(async () => {
    await dispatcher?.close();
    await t?.drop();
  });

  it("records SOURCE_BLOCKED without fetching the page", async () => {
    const run = new FetchRun(t.db, await loadFetchConfig(t.db), new HostLimiter(realClock), undefined, dispatcher);
    const r = await run.fetchPage("https://www.covenant-studios.co.za/");
    expect(r).toMatchObject({ recorded: true, outcome: "SOURCE_BLOCKED", httpStatus: null });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((u) => new URL(u).pathname === "/robots.txt")).toBe(true);
    if (r.recorded) {
      const rows = await t.pool.query(
        `select p.http_status as page_status, p.raw_content as page_body, r.purpose, r.http_status as robots_status, r.raw_content as robots_body
         from source_records p join source_records r on r.id = p.robots_source_record_id where p.id = $1`,
        [r.sourceRecordId],
      );
      expect(rows.rows[0]).toMatchObject({ page_status: null, page_body: null, purpose: "robots", robots_status: 200 });
      console.log(`covenant-studios.co.za robots.txt:\n${rows.rows[0].robots_body}`);
    }
  }, 120_000);
});

