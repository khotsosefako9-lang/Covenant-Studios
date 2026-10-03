// The only code in the system that makes requests to prospect infrastructure.
//
// Every fetch is recorded as a source record, whatever happens, with its outcome as data.
// What this layer will never do, by design and not behind any flag: change or rotate its
// identity, route through proxies to change origin, solve CAPTCHAs, or retry, work around
// or ignore a robots.txt disallow. A site that blocks us is recorded as blocked.
import { createHash } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Agent, type Dispatcher } from "undici";
import { ROBOTS_MAX_BYTES, type RobotsPolicy, isAllowed, policyFromFetch } from "@/core/robots";
import * as s from "@/db/schema/index";
import { parseSetting } from "@/db/validation";
import { type GetResult, type Outcome, decodeBody, httpGet, parseRetryAfter } from "./http";
import { ROBOTS_TOKEN, USER_AGENT } from "./identity";
import { type Clock, HostLimiter, realClock } from "./limiter";

type Db = NodePgDatabase<typeof s>;

export const PAGE_TYPES = ["text/html", "application/xhtml+xml"] as const;
const ROBOTS_MAX_REDIRECTS = 5; // RFC 9309 §2.3.1.2

export interface FetchConfig {
  minDelayMs: number;
  maxRetries: number;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  maxBodyBytes: number;
  maxRedirects: number;
  hostBudgetPerRun: number;
  cacheTtlMs: number;
  robotsCacheTtlMs: number;
}

export async function loadFetchConfig(db: Db): Promise<FetchConfig> {
  const rows = await db.select({ key: s.settings.key, value: s.settings.value }).from(s.settings);
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const get = <K extends Parameters<typeof parseSetting>[0]>(k: K) => {
    if (!v.has(k)) throw new Error(`Setting ${k} is missing; run npm run db:setup`);
    return parseSetting(k, v.get(k));
  };
  return {
    minDelayMs: get("fetch_min_delay_ms"),
    maxRetries: get("fetch_max_retries"),
    connectTimeoutMs: get("fetch_connect_timeout_ms"),
    readTimeoutMs: get("fetch_read_timeout_ms"),
    maxBodyBytes: get("fetch_max_body_bytes"),
    maxRedirects: get("fetch_max_redirects"),
    hostBudgetPerRun: get("fetch_host_budget_per_run"),
    cacheTtlMs: get("fetch_cache_ttl_hours") * 3_600_000,
    robotsCacheTtlMs: get("robots_cache_ttl_hours") * 3_600_000,
  };
}

export async function isFetchPaused(db: Db): Promise<boolean> {
  const [row] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, "fetch_paused"));
  // Missing setting = paused: fail closed.
  return row ? parseSetting("fetch_paused", row.value) : true;
}

export interface FetchOptions {
  companyId?: string | null;
  traceId?: string | null;
}

export type FetchResult =
  | {
      recorded: true;
      sourceRecordId: string;
      outcome: Outcome;
      httpStatus: number | null;
      finalUrl: string;
      /** 304, or a 200 whose content hash equals the previous OK fetch: do not re-analyse. */
      unchanged: boolean;
      previousSourceRecordId: string | null;
    }
  | { recorded: false; reason: "cached"; sourceRecordId: string; outcome: "OK" }
  | { recorded: false; reason: "paused" | "budget_exhausted" | "invalid_url"; detail: string };

interface RobotsInfo {
  recordId: string;
  policy: RobotsPolicy;
  /** Set when robots.txt could not be retrieved at all (no HTTP response). */
  networkOutcome: Outcome | null;
}

interface Attempt {
  result: GetResult;
  attempts: number;
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export function hostKey(u: URL): string {
  return u.port ? `${u.hostname}:${u.port}` : u.hostname;
}

/**
 * One fetch run. Holds the per-host request budget for the run; politeness (rate limits)
 * is per process and shared through the limiter.
 */
export class FetchRun {
  private readonly budgetUsed = new Map<string, number>();
  private readonly robots = new Map<string, Promise<RobotsInfo>>();
  private readonly dispatcher: Dispatcher;
  private readonly ownsDispatcher: boolean;
  private sourceId: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: FetchConfig,
    private readonly limiter: HostLimiter,
    private readonly clock: Clock = realClock,
    /**
     * Transport override, for tests and for egress a hosting network mandates. It must
     * never be used to change the identity or apparent origin of requests.
     */
    dispatcher?: Dispatcher,
  ) {
    this.ownsDispatcher = !dispatcher;
    this.dispatcher =
      dispatcher ?? new Agent({ connect: { timeout: config.connectTimeoutMs }, connections: 1, pipelining: 1 });
  }

  async close(): Promise<void> {
    if (this.ownsDispatcher) await this.dispatcher.close();
  }

  requestsUsed(host: string): number {
    return this.budgetUsed.get(host) ?? 0;
  }

  private takeBudget(host: string): boolean {
    const used = this.budgetUsed.get(host) ?? 0;
    if (used >= this.config.hostBudgetPerRun) return false;
    this.budgetUsed.set(host, used + 1);
    return true;
  }

  private gapFor(policy: RobotsPolicy | null): number {
    const crawl = (policy?.crawlDelaySeconds ?? 0) * 1000;
    return Math.max(this.config.minDelayMs, crawl);
  }

  private async websiteSourceId(): Promise<string> {
    if (this.sourceId) return this.sourceId;
    const [row] = await this.db.select({ id: s.sources.id }).from(s.sources).where(eq(s.sources.key, "website_fetch"));
    if (!row) throw new Error("Source website_fetch is missing; run npm run db:setup");
    this.sourceId = row.id;
    return row.id;
  }

  /**
   * One request (with retries for transient failures) through the limiter and budget.
   * Returns null when the budget or the pause switch stops it before any request.
   */
  private async attempt(
    url: URL,
    gapMs: number,
    opts: Omit<Parameters<typeof httpGet>[1], "dispatcher" | "readTimeoutMs">,
  ): Promise<Attempt | { stopped: "paused" | "budget_exhausted" }> {
    const host = hostKey(url);
    let attempts = 0;
    for (;;) {
      if (await isFetchPaused(this.db)) return { stopped: "paused" };
      if (!this.takeBudget(host)) return { stopped: "budget_exhausted" };
      attempts++;
      const result = await this.limiter.run(host, gapMs, () =>
        httpGet(url.toString(), { ...opts, dispatcher: this.dispatcher, readTimeoutMs: this.config.readTimeoutMs }),
      );
      const transient =
        (result.kind === "error" && result.retryable) || (result.kind === "response" && result.status >= 500);
      if (!transient || attempts > this.config.maxRetries) return { result, attempts };
      // Exponential backoff scaled from this host's politeness gap: 2x, 4x, 8x the gap.
      await this.clock.sleep(gapMs * 2 ** attempts);
    }
  }

  private async record(values: Omit<typeof s.sourceRecords.$inferInsert, "sourceId" | "retrievalMethod" | "userAgent">) {
    const [row] = await this.db
      .insert(s.sourceRecords)
      .values({ ...values, sourceId: await this.websiteSourceId(), retrievalMethod: "http_fetch", userAgent: USER_AGENT })
      .returning({ id: s.sourceRecords.id });
    if (!row) throw new Error("source record insert returned no row");
    return row.id;
  }

  /** robots.txt for an origin: from this run, from a fresh stored record, or fetched now. */
  private robotsFor(origin: URL, opts: FetchOptions): Promise<RobotsInfo> {
    const key = `${origin.protocol}//${hostKey(origin)}`;
    let p = this.robots.get(key);
    if (!p) {
      p = this.loadRobots(origin, opts);
      this.robots.set(key, p);
    }
    return p;
  }

  private async loadRobots(origin: URL, opts: FetchOptions): Promise<RobotsInfo> {
    const host = hostKey(origin);
    const robotsUrl = new URL("/robots.txt", origin);
    const since = new Date(this.clock.now() - this.config.robotsCacheTtlMs);
    const [cached] = await this.db
      .select()
      .from(s.sourceRecords)
      .where(
        and(
          eq(s.sourceRecords.purpose, "robots"),
          eq(s.sourceRecords.url, robotsUrl.toString()),
          gte(s.sourceRecords.fetchedAt, since),
        ),
      )
      .orderBy(desc(s.sourceRecords.fetchedAt))
      .limit(1);
    // Reuse a stored answer only if the server actually answered (not a network failure or 5xx/429).
    if (cached && cached.httpStatus !== null && cached.httpStatus < 500 && cached.httpStatus !== 429) {
      return {
        recordId: cached.id,
        policy: policyFromFetch(cached.httpStatus, cached.rawContent, ROBOTS_TOKEN),
        networkOutcome: null,
      };
    }

    const chain = [robotsUrl.toString()];
    let current = robotsUrl;
    let attempts = 0;
    for (let hop = 0; ; hop++) {
      const a = await this.attempt(current, this.config.minDelayMs, {
        maxBytes: ROBOTS_MAX_BYTES,
        acceptTypes: null,
        onOversize: "truncate",
      });
      const fetchedAt = new Date(this.clock.now());
      const base = {
        companyId: opts.companyId ?? null,
        purpose: "robots" as const,
        host,
        url: robotsUrl.toString(),
        finalUrl: current.toString(),
        redirectChain: chain.length > 1 ? chain : null,
        fetchedAt,
        traceId: opts.traceId ?? null,
      };
      if ("stopped" in a) {
        // No answer could be obtained this run: treat as unreachable (complete disallow).
        const recordId = await this.record({
          ...base,
          fetchOutcome: "UNREACHABLE",
          attempts,
          errorDetail: `robots.txt not requested: ${a.stopped === "paused" ? "fetching is paused" : "host request budget for this run exhausted"}`,
        });
        return { recordId, policy: policyFromFetch(null, null, ROBOTS_TOKEN), networkOutcome: "UNREACHABLE" };
      }
      attempts += a.attempts;
      const r = a.result;
      if (r.kind === "error") {
        const recordId = await this.record({ ...base, fetchOutcome: r.outcome, attempts, errorDetail: r.detail });
        return { recordId, policy: policyFromFetch(null, null, ROBOTS_TOKEN), networkOutcome: r.outcome };
      }
      const location = r.headers.location;
      if (r.status >= 300 && r.status < 400 && location && hop < ROBOTS_MAX_REDIRECTS) {
        const next = new URL(location, current);
        if (!chain.includes(next.toString())) {
          chain.push(next.toString());
          current = next;
          continue;
        }
      }
      const text = r.body ? decodeBody(r.body, r.headers["content-type"]) : null;
      const outcome: Outcome =
        r.status >= 200 && r.status < 300 ? "OK" : r.status === 403 || r.status === 429 ? "BLOCKED_BY_SERVER" : "HTTP_ERROR";
      const recordId = await this.record({
        ...base,
        fetchOutcome: outcome,
        httpStatus: r.status,
        contentType: r.headers["content-type"] ?? null,
        contentHash: r.body ? sha256(r.body) : null,
        byteSize: r.body ? r.body.length : null,
        rawContent: text,
        attempts,
        errorDetail: r.truncated ? `robots.txt truncated to ${ROBOTS_MAX_BYTES} bytes` : null,
      });
      const status = r.status >= 300 && r.status < 400 ? null : r.status;
      return { recordId, policy: policyFromFetch(status, text, ROBOTS_TOKEN), networkOutcome: null };
    }
  }

  /** Fetches one page, obeying robots.txt for every host in the redirect chain. */
  async fetchPage(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
    let start: URL;
    try {
      start = new URL(rawUrl);
    } catch {
      return { recorded: false, reason: "invalid_url", detail: `"${rawUrl}" is not a URL` };
    }
    if (start.protocol !== "http:" && start.protocol !== "https:") {
      return { recorded: false, reason: "invalid_url", detail: `${start.protocol} is not http or https` };
    }
    start.hash = "";
    if (await isFetchPaused(this.db)) return { recorded: false, reason: "paused", detail: "Fetching is paused" };

    const url = start.toString();
    const [previous] = await this.db
      .select()
      .from(s.sourceRecords)
      .where(and(eq(s.sourceRecords.purpose, "page"), eq(s.sourceRecords.url, url), eq(s.sourceRecords.fetchOutcome, "OK")))
      .orderBy(desc(s.sourceRecords.fetchedAt))
      .limit(1);
    if (previous && this.clock.now() - previous.fetchedAt.getTime() < this.config.cacheTtlMs) {
      return { recorded: false, reason: "cached", sourceRecordId: previous.id, outcome: "OK" };
    }
    // The content a 304 refers to: the last record that actually holds a body.
    const contentSource = previous?.revalidatedFromId
      ? ((await this.db.select().from(s.sourceRecords).where(eq(s.sourceRecords.id, previous.revalidatedFromId)))[0] ?? previous)
      : previous;

    const host = hostKey(start);
    const chain = [url];
    let current = start;
    let attempts = 0;
    for (let hop = 0; ; hop++) {
      const robots = await this.robotsFor(current, opts);
      const fetchedAt = () => new Date(this.clock.now());
      const base = {
        companyId: opts.companyId ?? null,
        purpose: "page" as const,
        host,
        url,
        finalUrl: current.toString(),
        redirectChain: chain.length > 1 ? chain : null,
        robotsSourceRecordId: robots.recordId,
        traceId: opts.traceId ?? null,
      };
      const finish = async (values: Partial<typeof s.sourceRecords.$inferInsert> & { fetchOutcome: Outcome }) => {
        const id = await this.record({ ...base, fetchedAt: fetchedAt(), attempts, ...values });
        return {
          recorded: true as const,
          sourceRecordId: id,
          outcome: values.fetchOutcome,
          httpStatus: values.httpStatus ?? null,
          finalUrl: current.toString(),
          unchanged: false,
          previousSourceRecordId: previous?.id ?? null,
        };
      };

      if (robots.networkOutcome) {
        return finish({
          fetchOutcome: robots.networkOutcome,
          errorDetail: "robots.txt could not be retrieved, so the page was not requested",
        });
      }
      const path = `${current.pathname}${current.search}`;
      if (!isAllowed(robots.policy, path)) {
        return finish({
          fetchOutcome: "SOURCE_BLOCKED",
          errorDetail: `robots.txt disallows ${path} for ${ROBOTS_TOKEN} (rules for ${robots.policy.matchedAgent ?? "no agent"})`,
        });
      }

      const a = await this.attempt(current, this.gapFor(robots.policy), {
        maxBytes: this.config.maxBodyBytes,
        acceptTypes: PAGE_TYPES,
        onOversize: "abort",
        conditional: hop === 0 && contentSource ? { etag: contentSource.etag, lastModified: contentSource.lastModified } : undefined,
      });
      if ("stopped" in a) {
        if (hop === 0) {
          return { recorded: false, reason: a.stopped, detail: a.stopped === "paused" ? "Fetching is paused" : `Request budget for ${host} exhausted in this run` };
        }
        return finish({
          fetchOutcome: "HTTP_ERROR",
          errorDetail: `Redirect not followed: ${a.stopped === "paused" ? "fetching was paused" : "host request budget exhausted"}`,
        });
      }
      attempts += a.attempts;
      const r = a.result;
      if (r.kind === "error") return finish({ fetchOutcome: r.outcome, errorDetail: r.detail });

      const status = r.status;
      if (status >= 300 && status < 400 && status !== 304) {
        const location = r.headers.location;
        if (!location) return finish({ fetchOutcome: "HTTP_ERROR", httpStatus: status, errorDetail: "Redirect without a Location header" });
        const next = new URL(location, current);
        next.hash = "";
        if (chain.includes(next.toString())) {
          chain.push(next.toString());
          return finish({ fetchOutcome: "REDIRECT_LOOP", httpStatus: status, redirectChain: chain, errorDetail: `Redirect loop back to ${next}` });
        }
        if (hop + 1 > this.config.maxRedirects) {
          chain.push(next.toString());
          return finish({
            fetchOutcome: "REDIRECT_LOOP",
            httpStatus: status,
            redirectChain: chain,
            errorDetail: `More than ${this.config.maxRedirects} redirects`,
          });
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          return finish({ fetchOutcome: "HTTP_ERROR", httpStatus: status, errorDetail: `Redirect to unsupported scheme ${next.protocol}` });
        }
        chain.push(next.toString());
        current = next;
        continue;
      }

      if (status === 304 && contentSource) {
        return {
          ...(await finish({
            fetchOutcome: "OK",
            httpStatus: 304,
            revalidatedFromId: contentSource.id,
            contentHash: contentSource.contentHash,
            contentType: contentSource.contentType,
            etag: r.headers.etag ?? contentSource.etag,
            lastModified: r.headers["last-modified"] ?? contentSource.lastModified,
          })),
          unchanged: true,
        };
      }
      if (status === 403) return finish({ fetchOutcome: "BLOCKED_BY_SERVER", httpStatus: status, errorDetail: "403 Forbidden" });
      if (status === 429) {
        const wait = parseRetryAfter(r.headers["retry-after"], this.clock.now());
        if (wait !== null) this.limiter.coolDown(hostKey(current), this.clock.now() + wait);
        return finish({
          fetchOutcome: "BLOCKED_BY_SERVER",
          httpStatus: status,
          errorDetail: `429 Too Many Requests${wait !== null ? `; Retry-After ${Math.round(wait / 1000)}s honoured for this host` : ""}`,
        });
      }
      if (status < 200 || status >= 300) return finish({ fetchOutcome: "HTTP_ERROR", httpStatus: status, errorDetail: `HTTP ${status}` });

      const contentType = r.headers["content-type"] ?? null;
      if (r.outcome) return finish({ fetchOutcome: r.outcome, httpStatus: status, contentType, errorDetail: r.detail });
      const body = r.body ?? new Uint8Array();
      const hash = sha256(body);
      const result = await finish({
        fetchOutcome: "OK",
        httpStatus: status,
        contentType,
        contentHash: hash,
        byteSize: body.length,
        rawContent: decodeBody(body, contentType ?? undefined),
        etag: r.headers.etag ?? null,
        lastModified: r.headers["last-modified"] ?? null,
      });
      return { ...result, unchanged: contentSource?.contentHash === hash };
    }
  }
}
