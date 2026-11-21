import test from "node:test";
import assert from "node:assert/strict";
import { Providers, LIMITS } from "../core/providers.ts";
import { Throttle } from "../core/throttle.ts";

/** A clock that moves only when something sleeps, so nothing here waits for real. */
const fakeClock = () => {
  const clock = {
    time: 0,
    now: () => clock.time,
    sleep: async (ms: number) => {
      clock.time += ms;
    },
  };
  return clock;
};

test("requests over a host's limit wait their turn, in order", async () => {
  const clock = fakeClock();
  const throttle = new Throttle({ limits: { host: { calls: 2, per: 1000 } }, ...clock });
  const started: [number, number][] = [];
  await Promise.all(
    [0, 1, 2, 3, 4].map((index) =>
      throttle.take("host")!.then(() => started.push([index, clock.time])),
    ),
  );
  assert.deepEqual(started, [[0, 0], [1, 0], [2, 1000], [3, 1000], [4, 2000]]);
  // Another host, and one with no limit, are not held up.
  assert.equal(throttle.take("elsewhere"), undefined);
});

test("a pause holds every request to the host, and a cancelled one lets the rest through", async () => {
  const clock = fakeClock();
  const throttle = new Throttle({ limits: { host: { calls: 10, per: 1000 } }, ...clock });
  await throttle.take("host");
  throttle.pause("host", 3000);
  // A shorter pause asked for later does not shorten it.
  throttle.pause("host", 1000);
  await throttle.take("host");
  assert.equal(clock.time, 3000);

  const full = new Throttle({ limits: { host: { calls: 1, per: 1000 } }, ...fakeClock() });
  await full.take("host");
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(full.take("host", controller.signal)!, /cancelled/);
  await full.take("host");
});

test("a burst of lookups over TVmaze's limit all complete, in order, with no busy failure", async () => {
  const clock = fakeClock();
  const asked: [string, number][] = [];
  let refused = false;
  const providers = new Providers({
    ...clock,
    fetcher: async (url) => {
      const query = url.searchParams.get("q") ?? "";
      // Like TVmaze, refuse one request over 20 in 10 seconds; once is enough to show a 429 is waited out.
      if (!refused && query === "Show 30") {
        refused = true;
        return new Response("", { status: 429, headers: { "Retry-After": "2" } });
      }
      asked.push([query, clock.time]);
      return Response.json([{ show: { id: Number(query.slice(5)), name: query, premiered: "2020-01-01" } }]);
    },
  });
  const queries = Array.from({ length: 45 }, (_, index) => `Show ${index}`);
  const results = await Promise.all(
    queries.map((query) => providers.search({ provider: "tvmaze", kind: "tv", query })),
  );
  assert.deepEqual(results.map((found) => found[0]?.title), queries);
  // Asked in the order they came, except the one that was refused and asked again later.
  assert.deepEqual(
    asked.map(([query]) => query),
    [...queries.filter((query) => query !== "Show 30"), "Show 30"],
  );
  // Never more than TVmaze's limit in any ten seconds.
  const { calls, per } = LIMITS["api.tvmaze.com"]!;
  for (const [, at] of asked)
    assert.ok(asked.filter(([, other]) => other >= at && other < at + per).length <= calls);
});

test("callers asking for the same address at once share one request", async () => {
  let requests = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const providers = new Providers({
    fetcher: async () => {
      requests++;
      await held;
      return Response.json([{ show: { id: 1, name: "Show", premiered: "2020-01-01" } }]);
    },
  });
  const input = { provider: "tvmaze" as const, kind: "tv" as const, query: "Show" };
  const asking = [providers.search(input), providers.search(input), providers.search(input)];
  release();
  const [first, second, third] = await Promise.all(asking);
  assert.equal(requests, 1);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  // Each caller gets its own copy.
  assert.notEqual(second, first);

  // A failure is shared too, and the next ask tries again.
  let failing = true;
  const flaky = new Providers({
    fetcher: async () => {
      requests++;
      return failing ? new Response("", { status: 500 }) : Response.json([]);
    },
  });
  requests = 0;
  const failed = await Promise.allSettled([flaky.search(input), flaky.search(input)]);
  assert.deepEqual(failed.map((result) => result.status), ["rejected", "rejected"]);
  assert.equal(requests, 1);
  failing = false;
  assert.deepEqual(await flaky.search(input), []);
});
