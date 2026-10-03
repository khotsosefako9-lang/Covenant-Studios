// Local fixture HTTP(S) servers and a fake clock for fetch-layer tests. No live sites.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock } from "@/fetch/limiter";

export type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface Fixture {
  origin: string;
  host: string;
  requests: { path: string; userAgent: string | undefined; headers: IncomingMessage["headers"] }[];
  maxInFlight: number;
  close(): Promise<void>;
}

function track(routes: Record<string, Handler>, fallback?: Handler) {
  const state = { requests: [] as Fixture["requests"], inFlight: 0, maxInFlight: 0 };
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    res.on("close", () => state.inFlight--);
    const path = req.url ?? "/";
    state.requests.push({ path, userAgent: req.headers["user-agent"], headers: req.headers });
    const h = routes[path] ?? fallback;
    if (h) await h(req, res);
    else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  };
  return { state, handler };
}

export async function serve(routes: Record<string, Handler>, fallback?: Handler): Promise<Fixture> {
  const { state, handler } = track(routes, fallback);
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    requests: state.requests,
    get maxInFlight() {
      return state.maxInFlight;
    },
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

/** HTTPS server with a freshly generated self-signed certificate, which nothing trusts. */
export async function serveSelfSignedTls(routes: Record<string, Handler>): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), "covenant-tls-"));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
  ], { stdio: "ignore" });
  const { state, handler } = track(routes);
  const server = createHttpsServer(
    { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) },
    (req, res) => void handler(req, res),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `https://localhost:${port}`,
    host: `localhost:${port}`,
    requests: state.requests,
    get maxInFlight() {
      return state.maxInFlight;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export const html = (body: string, extra: Record<string, string> = {}): Handler => (_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...extra });
  res.end(`<!doctype html><html><body>${body}</body></html>`);
};

export const robots = (text: string): Handler => (_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(text);
};

export const status = (code: number, headers: Record<string, string> = {}): Handler => (_req, res) => {
  res.writeHead(code, headers);
  res.end();
};

/** A clock whose sleeps return immediately and are recorded, so politeness waits are observable. */
export class FakeClock implements Clock {
  t = Date.now();
  sleeps: number[] = [];
  now() {
    return this.t;
  }
  async sleep(ms: number) {
    this.sleeps.push(ms);
    this.t += ms;
  }
  advance(ms: number) {
    this.t += ms;
  }
}
