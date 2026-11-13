import test from "node:test";
import assert from "node:assert/strict";
import { ExitGuard } from "../desktop/exitGuard.ts";
import type { BatchKind, ExitChoice, ExitKind } from "../desktop/exitGuard.ts";

/** A guard whose question is answered by the test, and a batch the test finishes by hand. */
function setup() {
  const asked: BatchKind[] = [];
  const exits: ExitKind[] = [];
  let answer: (choice: ExitChoice) => void = () => {};
  const guard = new ExitGuard({
    ask: (kind) => {
      asked.push(kind);
      return new Promise((resolve) => (answer = resolve));
    },
    exit: (how) => exits.push(how),
  });
  let finish: () => void = () => {};
  let signal: AbortSignal | undefined;
  const start = (kind: BatchKind = "apply") =>
    guard.run(kind, (given) => {
      signal = given;
      return new Promise<string>((resolve) => (finish = () => resolve("finished")));
    });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    guard,
    asked,
    exits,
    start,
    settle,
    answer: async (choice: ExitChoice) => (answer(choice), settle()),
    finish: async () => (finish(), settle()),
    signal: () => signal!,
  };
}

test("closing with nothing running goes ahead without asking", () => {
  const { guard, asked } = setup();
  assert.equal(guard.request("close"), true);
  assert.equal(guard.request("quit"), true);
  assert.deepEqual(asked, []);
});

test("only one file operation runs at a time", async () => {
  const { guard, start, finish } = setup();
  const running = start();
  await assert.rejects(guard.run("undo", async () => {}), /already running/);
  await finish();
  assert.equal(await running, "finished");
  assert.equal(guard.busy, false);
});

test("keeping the app open lets the batch finish and nothing closes", async () => {
  const { guard, asked, exits, start, answer, finish, signal } = setup();
  const running = start("undo");
  assert.equal(guard.request("close"), false);
  assert.deepEqual(asked, ["undo"]);
  await answer("keep");
  await finish();
  assert.equal(await running, "finished");
  assert.equal(signal().aborted, false);
  assert.deepEqual(exits, []);
});

test("closing when finished waits for the batch, then closes", async () => {
  const { guard, exits, start, answer, finish, signal } = setup();
  const running = start();
  assert.equal(guard.request("close"), false);
  await answer("wait");
  assert.deepEqual(exits, []);
  assert.equal(signal().aborted, false);
  await finish();
  await running;
  assert.deepEqual(exits, ["close"]);
});

test("stopping asks the batch to stop, and closes once it has", async () => {
  const { guard, exits, start, answer, finish, signal } = setup();
  const running = start();
  assert.equal(guard.request("quit"), false);
  await answer("stop");
  assert.equal(signal().aborted, true);
  // The operation in hand still finishes before anything closes.
  assert.deepEqual(exits, []);
  await finish();
  await running;
  assert.deepEqual(exits, ["quit"]);
});

test("a batch that fails still lets the chosen exit happen", async () => {
  const { guard, exits, answer, settle } = setup();
  let fail: (error: Error) => void = () => {};
  const running = guard.run("apply", () => new Promise((_, reject) => (fail = reject)));
  guard.request("close");
  await answer("stop");
  fail(new Error("Stopped after 2 operations: You stopped the batch."));
  await assert.rejects(running, /You stopped the batch/);
  await settle();
  assert.deepEqual(exits, ["close"]);
});

test("asking again while the question is open does not ask twice, and quitting wins", async () => {
  const { guard, asked, exits, start, answer, finish } = setup();
  const running = start();
  guard.request("quit");
  guard.request("close");
  assert.deepEqual(asked, ["apply"]);
  await answer("wait");
  // A later close after choosing to quit still quits.
  guard.request("close");
  await answer("wait");
  await finish();
  await running;
  assert.deepEqual(exits, ["quit"]);
});

test("a batch that ends while the question is open exits as soon as it is answered", async () => {
  const { guard, exits, start, answer, finish } = setup();
  const running = start();
  guard.request("close");
  await finish();
  await running;
  assert.deepEqual(exits, []);
  await answer("stop");
  assert.deepEqual(exits, ["close"]);
});

test("a question that cannot be shown keeps the app open", async () => {
  const exits: ExitKind[] = [];
  const guard = new ExitGuard({
    ask: async () => {
      throw new Error("no window");
    },
    exit: (how) => exits.push(how),
  });
  let finish: () => void = () => {};
  const running = guard.run("apply", () => new Promise<void>((resolve) => (finish = resolve)));
  guard.request("close");
  await new Promise((resolve) => setImmediate(resolve));
  finish();
  await running;
  assert.deepEqual(exits, []);
});
