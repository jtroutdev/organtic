import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppLog } from "../desktop/appLog.ts";

async function folder(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "organtic-log-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const fixed = () => new Date("2026-11-12T10:00:00.000Z");

test("the log writes the home folder as ~, and not a longer name that starts the same", async (t) => {
  const dir = await folder(t);
  const file = path.join(dir, "logs", "organtic.log");
  const log = new AppLog({ file, home: "/home/sam", now: fixed });
  log.error("apply", new Error("Cannot move /home/sam/Videos/A.mkv to /home/samuel/B.mkv"));
  const text = await fs.readFile(file, "utf8");
  assert.match(text, /^2026-11-12T10:00:00\.000Z ERROR apply: Error: Cannot move ~\/Videos\/A\.mkv to \/home\/samuel\/B\.mkv/);
  assert.doesNotMatch(text, /\/home\/sam\//);
  assert.equal(log.shown(file), file.replace("/home/sam", "~"));
});

test("the log hides every token and key it was given, and ignores empty ones", async (t) => {
  const dir = await folder(t);
  const file = path.join(dir, "organtic.log");
  const log = new AppLog({ file, home: "/home/sam", now: fixed });
  log.secret("eyJhbGciOiJIUzI1NiJ9.secret");
  log.secret("");
  log.secret("  4321  ");
  log.error("search", "Refused eyJhbGciOiJIUzI1NiJ9.secret with pin 4321");
  log.info("plain text stays");
  const text = await fs.readFile(file, "utf8");
  assert.match(text, /Refused \[hidden\] with pin \[hidden\]/);
  assert.doesNotMatch(text, /eyJ|4321/);
  assert.match(text, /INFO plain text stays/);
});

test("a stack is kept, indented under its entry", async (t) => {
  const dir = await folder(t);
  const file = path.join(dir, "organtic.log");
  const log = new AppLog({ file, home: "/nowhere", now: fixed });
  const error = new Error("broke");
  error.stack = "Error: broke\n    at start (/app/main.js:1:1)";
  log.error("Start-up", error);
  assert.equal(
    await fs.readFile(file, "utf8"),
    "2026-11-12T10:00:00.000Z ERROR Start-up: Error: broke\n      at start (/app/main.js:1:1)\n",
  );
});

test("the log rotates to one older file and never grows past its limit", async (t) => {
  const dir = await folder(t);
  const file = path.join(dir, "organtic.log");
  const log = new AppLog({ file, home: "/nowhere", maxBytes: 200, now: fixed });
  for (let index = 0; index < 20; index++) log.info(`entry ${index} ${"x".repeat(40)}`);
  const current = await fs.readFile(file, "utf8");
  const older = await fs.readFile(`${file}.1`, "utf8");
  assert.ok(Buffer.byteLength(current) <= 200);
  assert.ok(Buffer.byteLength(older) <= 200);
  assert.match(current, /entry 19 /);
  assert.deepEqual((await fs.readdir(dir)).sort(), ["organtic.log", "organtic.log.1"]);
});

test("one very long entry is cut", async (t) => {
  const dir = await folder(t);
  const file = path.join(dir, "organtic.log");
  new AppLog({ file, home: "/nowhere", now: fixed }).info("y".repeat(50_000));
  const text = await fs.readFile(file, "utf8");
  assert.ok(text.length < 9_000);
  assert.match(text, / \[cut\]\n$/);
});

test("a log that cannot be written is ignored", async (t) => {
  const dir = await folder(t);
  const blocker = path.join(dir, "not-a-folder");
  await fs.writeFile(blocker, "");
  const log = new AppLog({ file: path.join(blocker, "organtic.log"), home: "/nowhere" });
  assert.doesNotThrow(() => log.error("anything", new Error("lost")));
});
