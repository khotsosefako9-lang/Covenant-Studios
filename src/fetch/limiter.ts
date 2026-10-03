// Per-host politeness: one request at a time per host, and a minimum gap between the end
// of one request and the start of the next. Hosts are independent of each other.
// In-process: M0 runs a single fetching worker (see README).

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

interface HostState {
  tail: Promise<unknown>;
  /** Earliest time the next request may start. */
  notBefore: number;
}

export class HostLimiter {
  private readonly hosts = new Map<string, HostState>();

  constructor(private readonly clock: Clock) {}

  private state(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      s = { tail: Promise.resolve(), notBefore: 0 };
      this.hosts.set(host, s);
    }
    return s;
  }

  /** Runs `fn` after any earlier request to `host` has finished and `gapMs` has passed since. */
  run<T>(host: string, gapMs: number, fn: () => Promise<T>): Promise<T> {
    const s = this.state(host);
    const result = s.tail.then(async () => {
      const wait = s.notBefore - this.clock.now();
      if (wait > 0) await this.clock.sleep(wait);
      try {
        return await fn();
      } finally {
        s.notBefore = Math.max(s.notBefore, this.clock.now() + gapMs);
      }
    });
    s.tail = result.catch(() => undefined);
    return result;
  }

  /** The host asked us to back off (429 Retry-After): nothing starts before `until`. */
  coolDown(host: string, until: number): void {
    const s = this.state(host);
    s.notBefore = Math.max(s.notBefore, until);
  }
}
