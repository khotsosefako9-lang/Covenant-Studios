// One HTTP GET, no redirect following, with hard size and content-type limits.
// Classification of failures into fetch outcomes lives here too.
import { type Dispatcher, request } from "undici";
import { USER_AGENT } from "./identity";

export type Outcome =
  | "OK"
  | "SOURCE_BLOCKED"
  | "BLOCKED_BY_SERVER"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "UNREACHABLE"
  | "TLS_ERROR"
  | "TOO_LARGE"
  | "REDIRECT_LOOP"
  | "UNSUPPORTED_CONTENT_TYPE";

export interface GetOptions {
  dispatcher: Dispatcher;
  readTimeoutMs: number;
  maxBytes: number;
  /** Content types read in full; anything else is aborted after the headers. Null = accept any. */
  acceptTypes: readonly string[] | null;
  /** When the body exceeds maxBytes: "abort" fails the fetch, "truncate" keeps the first maxBytes (robots.txt). */
  onOversize: "abort" | "truncate";
  conditional?: { etag?: string | null; lastModified?: string | null };
}

export type GetResult =
  | {
      kind: "response";
      status: number;
      headers: Record<string, string>;
      /** Present for 2xx responses that passed the checks below. */
      body: Uint8Array | null;
      truncated: boolean;
      /** Milliseconds from sending the request to receiving the response headers. */
      responseMs: number;
      /** Set when the response is a terminal outcome other than a usable body. */
      outcome: Outcome | null;
      detail: string | null;
    }
  | { kind: "error"; outcome: Outcome; retryable: boolean; detail: string };

const header = (h: Record<string, string | string[] | undefined>, name: string): string | undefined => {
  const v = h[name];
  return Array.isArray(v) ? v.join(", ") : v;
};

export function mediaType(contentType: string | undefined): string | null {
  const t = contentType?.split(";")[0]?.trim().toLowerCase();
  return t ? t : null;
}

const HTML_SNIFF = /^\s*(<!doctype html|<html|<head|<body)/i;

export async function httpGet(url: string, opts: GetOptions): Promise<GetResult> {
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5,*/*;q=0.1",
  };
  if (opts.conditional?.etag) headers["if-none-match"] = opts.conditional.etag;
  if (opts.conditional?.lastModified) headers["if-modified-since"] = opts.conditional.lastModified;

  let res: Dispatcher.ResponseData;
  const started = performance.now();
  try {
    res = await request(url, {
      method: "GET",
      headers,
      dispatcher: opts.dispatcher,
      headersTimeout: opts.readTimeoutMs,
      bodyTimeout: opts.readTimeoutMs,
    });
  } catch (e) {
    return classifyError(e);
  }

  const responseMs = Math.round(performance.now() - started);
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    const s = header(res.headers, k);
    if (s !== undefined && v !== undefined) flat[k.toLowerCase()] = s;
  }
  const done = (outcome: Outcome | null, detail: string | null, body: Uint8Array | null = null, truncated = false): GetResult => ({
    kind: "response",
    status: res.statusCode,
    headers: flat,
    body,
    truncated,
    responseMs,
    outcome,
    detail,
  });
  // Destroying an undici body emits an AbortError; without a listener that is an uncaught
  // exception that would take the worker down. Abandoned bodies are destroyed quietly.
  const discard = () => {
    res.body.on("error", () => {});
    res.body.destroy();
  };

  if (res.statusCode < 200 || res.statusCode >= 300) {
    // Error and redirect bodies are not needed: drain a little (keeps the connection usable), then drop.
    await res.body.dump({ limit: 64 * 1024 }).catch(() => {});
    return done(null, null);
  }

  const type = mediaType(flat["content-type"]);
  if (type && opts.acceptTypes && !opts.acceptTypes.includes(type)) {
    discard();
    return done("UNSUPPORTED_CONTENT_TYPE", `Content-Type ${type} is not one of ${opts.acceptTypes.join(", ")}`);
  }
  const declared = Number(flat["content-length"]);
  if (opts.onOversize === "abort" && Number.isFinite(declared) && declared > opts.maxBytes) {
    discard();
    return done("TOO_LARGE", `Content-Length ${declared} exceeds the ${opts.maxBytes}-byte limit; not downloaded`);
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  try {
    for await (const chunk of res.body) {
      const buf = chunk as Buffer;
      if (size + buf.length > opts.maxBytes) {
        if (opts.onOversize === "abort") {
          discard();
          return done("TOO_LARGE", `Body exceeded the ${opts.maxBytes}-byte limit; download aborted at ${size + buf.length} bytes`);
        }
        chunks.push(buf.subarray(0, opts.maxBytes - size));
        size = opts.maxBytes;
        truncated = true;
        discard();
        break;
      }
      chunks.push(buf);
      size += buf.length;
    }
  } catch (e) {
    const c = classifyError(e);
    return c.kind === "error" ? { ...c, retryable: c.retryable } : c;
  }
  const body = new Uint8Array(Buffer.concat(chunks, size));

  if (!type && opts.acceptTypes) {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(body.subarray(0, 1024));
    if (!HTML_SNIFF.test(head)) return done("UNSUPPORTED_CONTENT_TYPE", "No Content-Type, and the body does not look like HTML");
  }
  return done(null, null, body, truncated);
}

const TLS_CODES = /^(CERT_|ERR_TLS_|ERR_SSL_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(VERIFY|GET)_|HOSTNAME_MISMATCH|EPROTO$)/;

function errorCodes(e: unknown): string[] {
  const codes: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    cur = (cur as { cause?: unknown }).cause;
  }
  return codes;
}

function messageOf(e: unknown): string {
  let cur: unknown = e;
  const parts: string[] = [];
  for (let i = 0; i < 5 && cur instanceof Error; i++) {
    parts.push(cur.message);
    cur = cur.cause;
  }
  return parts.filter(Boolean).join(": ") || String(e);
}

export function classifyError(e: unknown): Extract<GetResult, { kind: "error" }> {
  const codes = errorCodes(e);
  const detail = `${codes.join("/") || "error"}: ${messageOf(e)}`;
  if (codes.some((c) => TLS_CODES.test(c))) return { kind: "error", outcome: "TLS_ERROR", retryable: false, detail };
  if (codes.some((c) => /TIMEOUT|ETIMEDOUT/.test(c))) return { kind: "error", outcome: "TIMEOUT", retryable: true, detail };
  if (codes.includes("ENOTFOUND")) return { kind: "error", outcome: "UNREACHABLE", retryable: false, detail };
  return { kind: "error", outcome: "UNREACHABLE", retryable: true, detail };
}

/** Retry-After as milliseconds from now: delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | undefined, now: number): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

/** Decode a body using the Content-Type charset when it names one we know, else UTF-8. */
export function decodeBody(body: Uint8Array, contentType: string | undefined): string {
  const charset = contentType?.match(/charset\s*=\s*"?([^";\s]+)/i)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(body);
  }
}
