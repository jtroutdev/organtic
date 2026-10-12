import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanPaths, createPlan, applyPlan, undoBatch, history } from "../core/files.ts";
import type { FileOps } from "../core/files.ts";
import type { Media, Plan } from "../core/types.ts";

const MESSY = [
  "Severance.S01.1080p.WEB-DL-GRP/Severance.S01E01.1080p.WEB-DL-GRP.mkv",
  "Severance.S01.1080p.WEB-DL-GRP/Severance.S01E01.1080p.WEB-DL-GRP.en.srt",
  "Severance.S01.1080p.WEB-DL-GRP/Severance.S01E02.1080p.WEB-DL-GRP.mkv",
  "Arrival.2016.1080p.BluRay-GRP/arrival-grp.mkv",
  "Arrival.2016.1080p.BluRay-GRP/Subs/notes.txt",
];
const film: Media = {
  kind: "movie",
  title: "Arrival",
  year: 2016,
  provider: "tmdb",
  id: 329865,
  overview: "Hello",
};
const episode = (number: number, title: string): Media => ({
  kind: "tv",
  title: "Severance",
  year: 2022,
  provider: "tmdb",
  id: 95396,
  overview: "",
  season: 1,
  episode: number,
  episodeTitle: title,
});

/** A messy download and the plan that organises it: folders made and removed, moves and NFO files. */
async function library(t: TestContext) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "organtic-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const name of MESSY) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), `bytes of ${name}`);
  }
  const { files } = await scanPaths([dir]);
  const at = (name: string) => files.find((file) => file.path === path.join(dir, name))!;
  const plan = await createPlan(
    [
      { file: at(MESSY[0]!), media: episode(1, "Good News About Hell") },
      { file: at(MESSY[2]!), media: episode(2, "Half Loop") },
      { file: at(MESSY[3]!), media: film },
    ],
    { nfo: true },
  );
  assert.deepEqual(plan.errors, []);
  const journals = path.join(dir, ".journals");
  return { dir, plan, journals, journal: path.join(journals, `${plan.id}.jsonl`) };
}

/** Every folder and file under a library with each file's contents, so an undo can be compared exactly. */
async function snapshot(dir: string): Promise<Record<string, string | null>> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  const found: [string, string | null][] = [];
  for (const entry of entries) {
    const full = path.join(entry.parentPath, entry.name);
    const name = path.relative(dir, full).replaceAll(path.sep, "/");
    if (name.startsWith(".journals")) continue;
    found.push([name, entry.isFile() ? await fs.readFile(full, "utf8") : null]);
  }
  return Object.fromEntries(found.sort(([a], [b]) => a.localeCompare(b)));
}

const failure = () => Object.assign(new Error("input/output error"), { code: "EIO" });
const noLinks = () => Object.assign(new Error("operation not permitted"), { code: "EPERM" });

/** File calls that fail once, on the chosen call; `links: false` is a volume without hard links. */
function failingOn(call: number, links = true): FileOps {
  let calls = 0;
  const hit = () => calls++ === call;
  return {
    link: async (source, target) => {
      if (!links) throw noLinks();
      if (hit()) throw failure();
      return fs.link(source, target);
    },
    rename: async (source, target) => {
      if (hit()) throw failure();
      return fs.rename(source, target);
    },
  };
}
const linkless = failingOn(-1, false);

const moves = (plan: Plan) => plan.operations.filter((op) => op.type === "move").length;
const linesOf = async (journal: string) =>
  (await fs.readFile(journal, "utf8")).split("\n").filter(Boolean);
const statusOf = async (journals: string) => (await history(journals))[0]?.status;

test("the plan under test makes and removes folders, moves files and writes metadata", async (t) => {
  const { plan } = await library(t);
  const types = new Set(plan.operations.map((op) => op.type));
  assert.deepEqual([...types].sort(), ["mkdir", "move", "rmdir", "write"]);
  assert.ok(moves(plan) >= 4);
});

for (const links of [true, false]) {
  const volume = links ? "with hard links" : "without hard links";
  test(`a batch that fails at any move is undone to exactly what was there, ${volume}`, async (t) => {
    const count = moves((await library(t)).plan);
    for (let call = 0; call < count; call++) {
      const lib = await library(t);
      const before = await snapshot(lib.dir);
      await assert.rejects(
        applyPlan(lib.plan, lib.journals, failingOn(call, links)),
        /Stopped after \d+ operations: The disk reported a read or write error/,
        `move ${call}`,
      );
      assert.equal(await statusOf(lib.journals), "interrupted", `move ${call}`);
      assert.notDeepEqual(await snapshot(lib.dir), before, `move ${call} left nothing to undo`);
      await undoBatch(lib.plan.id, lib.journals, links ? fs : linkless);
      assert.deepEqual(await snapshot(lib.dir), before, `move ${call}`);
      assert.equal(await statusOf(lib.journals), "undone", `move ${call}`);
    }
  });

  test(`an undo that fails at any move finishes on the next attempt, ${volume}`, async (t) => {
    const count = moves((await library(t)).plan);
    for (let call = 0; call < count; call++) {
      const lib = await library(t);
      const before = await snapshot(lib.dir);
      await applyPlan(lib.plan, lib.journals, links ? fs : linkless);
      await assert.rejects(
        undoBatch(lib.plan.id, lib.journals, failingOn(call, links)),
        /input\/output error/,
        `move ${call}`,
      );
      assert.equal(await statusOf(lib.journals), "complete", `move ${call}`);
      await undoBatch(lib.plan.id, lib.journals, links ? fs : linkless);
      assert.deepEqual(await snapshot(lib.dir), before, `move ${call}`);
      assert.equal(await statusOf(lib.journals), "undone", `move ${call}`);
      await assert.rejects(undoBatch(lib.plan.id, lib.journals), /already been undone/);
    }
  });
}

/**
 * Leaves a library as a crash would: the first `done` operations carried out, and the journal
 * holding the whole plan followed by their records.
 */
async function stoppedAfter(t: TestContext, done: number) {
  const lib = await library(t);
  const before = await snapshot(lib.dir);
  const part = { ...lib.plan, operations: lib.plan.operations.slice(0, done) };
  await applyPlan(part, lib.journals);
  const [, ...records] = await linesOf(lib.journal);
  assert.equal(records.pop(), JSON.stringify({ type: "complete" }));
  const write = (lines: string[], tail = "") =>
    fs.writeFile(
      lib.journal,
      [JSON.stringify({ type: "plan", plan: lib.plan }), ...lines].join("\n") + "\n" + tail,
    );
  await write(records);
  return { ...lib, before, records, write };
}

test("a crash between any two journal records is undone to exactly what was there", async (t) => {
  const total = (await library(t)).plan.operations.length;
  const intent = (index: number) => JSON.stringify({ type: "intent", index });
  const cases: [string, (lib: Awaited<ReturnType<typeof stoppedAfter>>, done: number) => Promise<void>][] = [
    ["after an operation was recorded", async () => {}],
    // The operation happened but the process died before saying so.
    ["before an operation was recorded", (lib) => lib.write(lib.records.slice(0, -1))],
    // The next operation was announced and never started.
    ["after the next operation was announced", async (lib, done) => {
      if (done < total) await lib.write([...lib.records, intent(done)]);
    }],
    ["in the middle of writing a record", (lib) => lib.write(lib.records, '{"type":"int')],
  ];
  for (const [when, arrange] of cases)
    for (let done = 1; done <= total; done++) {
      const lib = await stoppedAfter(t, done);
      await arrange(lib, done);
      const where = `${when}, ${done} of ${total} done`;
      assert.equal(await statusOf(lib.journals), "interrupted", where);
      await undoBatch(lib.plan.id, lib.journals);
      assert.deepEqual(await snapshot(lib.dir), lib.before, where);
      assert.equal(await statusOf(lib.journals), "undone", where);
    }
});

test("a crash between linking a file's new name and removing its old one is undone", async (t) => {
  const { plan } = await library(t);
  for (const [index, op] of plan.operations.entries()) {
    if (op.type !== "move") continue;
    const lib = await stoppedAfter(t, index);
    const next = lib.plan.operations[index]!;
    assert.ok(next.type === "move");
    await fs.link(next.source, next.target);
    await lib.write([...lib.records, JSON.stringify({ type: "intent", index })]);
    await undoBatch(lib.plan.id, lib.journals);
    assert.deepEqual(await snapshot(lib.dir), lib.before, `operation ${index}`);
  }
});

test("an undo that stopped before recording its last step finishes on the next attempt", async (t) => {
  const count = moves((await library(t)).plan);
  for (let call = 1; call < count; call++) {
    const lib = await library(t);
    const before = await snapshot(lib.dir);
    await applyPlan(lib.plan, lib.journals);
    await assert.rejects(undoBatch(lib.plan.id, lib.journals, failingOn(call)), /input\/output error/);
    // The last step was put back, but the process died before saying so.
    const lines = await linesOf(lib.journal);
    assert.match(lines.at(-1)!, /"undo-done"/, `move ${call}`);
    await fs.writeFile(lib.journal, lines.slice(0, -1).join("\n") + "\n");
    await undoBatch(lib.plan.id, lib.journals);
    assert.deepEqual(await snapshot(lib.dir), before, `move ${call}`);
    assert.equal(await statusOf(lib.journals), "undone", `move ${call}`);
  }
});

test("a journal damaged in the middle is reported and left alone", async (t) => {
  const lib = await library(t);
  await applyPlan(lib.plan, lib.journals);
  const after = await snapshot(lib.dir);
  const lines = await linesOf(lib.journal);
  lines[2] = lines[2]!.slice(0, 5);
  await fs.writeFile(lib.journal, lines.join("\n") + "\n");
  assert.equal(await statusOf(lib.journals), "damaged");
  await assert.rejects(undoBatch(lib.plan.id, lib.journals), /Journal is damaged/);
  assert.deepEqual(await snapshot(lib.dir), after);
  assert.equal(await fs.readFile(lib.journal, "utf8"), lines.join("\n") + "\n");
});
