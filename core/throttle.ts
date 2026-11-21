/** At most `calls` requests to a host in any `per` milliseconds. */
export interface Limit {
  calls: number;
  per: number;
}

/**
 * Spaces out requests to each host so none goes over the host's published limit. A request
 * over the limit waits its turn, in the order it asked, rather than failing; a host that asks
 * for a pause with a 429 makes everyone waiting on it pause. Time and sleeping are passed in so
 * tests can run it without waiting.
 */
export class Throttle {
  #limits: Record<string, Limit>;
  #now: () => number;
  #sleep: (ms: number) => Promise<unknown>;
  /** When each host's recent requests started, oldest first. */
  #started = new Map<string, number[]>();
  /** The end of the queue for each host; each turn waits for the one before it. */
  #queue = new Map<string, Promise<unknown>>();
  /** A host's pause after it answered 429. */
  #pausedUntil = new Map<string, number>();

  constructor(options: {
    limits: Record<string, Limit>;
    now?: () => number;
    sleep: (ms: number) => Promise<unknown>;
  }) {
    this.#limits = options.limits;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep;
  }

  /**
   * Resolves when a request to `host` may start, and counts it as started. Rejects once
   * `signal` is aborted; the turns behind it carry on. A host with no limit gets `undefined`,
   * so its request can start without waiting even a moment.
   */
  take(host: string, signal?: AbortSignal): Promise<void> | undefined {
    const limit = this.#limits[host];
    if (!limit) return undefined;
    const turn = (this.#queue.get(host) ?? Promise.resolve()).then(() =>
      this.#wait(host, limit, signal),
    );
    // A cancelled turn does not hold up the ones behind it.
    this.#queue.set(host, turn.catch(() => {}));
    return turn;
  }

  /** Holds every request to `host` for `ms`, as a 429 with a retry time asks. */
  pause(host: string, ms: number) {
    const until = this.#now() + ms;
    if (until > (this.#pausedUntil.get(host) ?? 0)) this.#pausedUntil.set(host, until);
  }

  async #wait(host: string, limit: Limit, signal?: AbortSignal) {
    const started = this.#started.get(host) ?? [];
    this.#started.set(host, started);
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      const now = this.#now();
      while (started.length && now - started[0]! >= limit.per) started.shift();
      const paused = (this.#pausedUntil.get(host) ?? 0) - now;
      const full = started.length >= limit.calls ? started[0]! + limit.per - now : 0;
      const wait = Math.max(paused, full);
      if (wait <= 0) {
        started.push(now);
        return;
      }
      await this.#until(wait, signal);
    }
  }

  /** Sleeps for `ms`, or until `signal` is aborted. */
  #until(ms: number, signal?: AbortSignal) {
    if (!signal) return this.#sleep(ms);
    return new Promise<void>((resolve, reject) => {
      const stop = () => reject(signal.reason);
      signal.addEventListener("abort", stop, { once: true });
      void this.#sleep(ms).then(() => {
        signal.removeEventListener("abort", stop);
        resolve();
      });
    });
  }
}
