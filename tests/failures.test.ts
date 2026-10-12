import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  scanPaths,
  createPlan,
  applyPlan,
  checkRoom,
  history,
  messageOf,
  undoBatch,
} from "../core/files.ts";
import type { FileOps, RoomProbe } from "../core/files.ts";
import type { Media } from "../core/types.ts";

const film = (title: string, year: number, extra: Partial<Media> = {}): Media => ({
  kind: "movie",
  title,
  year,
  provider: "tmdb",
  id: 1,
  overview: "",
  ...extra,
});

async function library(t: TestContext, names: string[]) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "organtic-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const name of names) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), `bytes of ${name}`);
  }
  return { dir, journals: path.join(dir, ".journals") };
}
const fail = (code: string, message: string, where?: string) =>
  Object.assign(new Error(message), { code, ...(where ? { path: where } : {}) });

test("system errors are put in plain words, with the path they concern", () => {
  assert.equal(
    messageOf(fail("ENOSPC", "ENOSPC: no space left on device, write", "/films/a.nfo")),
    "The disk is full: /films/a.nfo",
  );
  assert.equal(messageOf(fail("EROFS", "EROFS: read-only file system")), "The disk is read-only.");
  assert.equal(messageOf(fail("EBUSY", "busy", "/films/a.mkv")), "It is in use by another program: /films/a.mkv");
  // Anything else, including the app's own messages, is passed on as it is.
  assert.equal(messageOf(new Error("Destination already exists: /films/a.mkv")), "Destination already exists: /films/a.mkv");
  assert.equal(messageOf(fail("EWEIRD", "something odd")), "something odd");
  assert.equal(messageOf("text"), "text");
});

test("an import reads what it can and lists what it could not, with why", async (t) => {
  const lib = await library(t, ["Open/Arrival.2016.mkv", "Locked/Dune.2021.mkv", "Heat.1995.mkv"]);
  const locked = path.join(lib.dir, "Locked");
  const missing = path.join(lib.dir, "Gone");
  await fs.chmod(locked, 0o000);
  const readable = await fs.readdir(locked).then(() => true, () => false);
  const result = await scanPaths([lib.dir, missing]).finally(() => fs.chmod(locked, 0o700));
  assert.deepEqual(
    result.files.map((file) => file.name).filter((name) => !name.startsWith("Dune")),
    ["Heat.1995.mkv", "Arrival.2016.mkv"],
  );
  assert.deepEqual(
    result.unread.find((item) => item.path === missing),
    { path: missing, reason: "It is no longer there" },
  );
  // Windows and a root user can read the folder whatever its mode says.
  if (readable) return t.diagnostic("folder permissions are not enforced here; only the missing path was checked");
  assert.deepEqual(result.unread, [
    { path: locked, reason: "Permission was denied" },
    { path: missing, reason: "It is no longer there" },
  ]);
  assert.equal(result.files.length, 2);
});

/** A film with a poster to fetch and an NFO to write, so a batch has every kind of change. */
async function filmBatch(t: TestContext) {
  const lib = await library(t, ["Arrival.2016.1080p-GRP/arrival.mkv", "Heat.1995.720p-GRP/heat.mkv"]);
  const { files } = await scanPaths([lib.dir]);
  const plan = await createPlan(
    [
      { file: files[0]!, media: film("Arrival", 2016, { posterUrl: "https://image.tmdb.org/t/p/original/a.jpg" }) },
      { file: files[1]!, media: film("Heat", 1995) },
    ],
    { nfo: true, artwork: true },
  );
  assert.deepEqual(plan.errors, []);
  return { ...lib, plan };
}
const offline: Pick<FileOps, "fetch"> = {
  fetch: async () => {
    throw new Error("offline");
  },
};

test("history says what became of each change in a batch that stopped", async (t) => {
  const lib = await filmBatch(t);
  const types = lib.plan.operations.map((op) => op.type);
  const second = types.lastIndexOf("move");
  let links = 0;
  const io: FileOps = {
    ...offline,
    link: async (source, target) => {
      if (links++ === 1) throw fail("ENOSPC", "ENOSPC: no space left on device, link", String(target));
      return fs.link(source, target);
    },
    rename: fs.rename,
  };
  await assert.rejects(applyPlan(lib.plan, lib.journals, io), /Stopped after \d+ operations: The disk is full: /);
  const [batch] = await history(lib.journals);
  const target = lib.plan.operations[second]!.target;
  assert.equal(batch!.status, "interrupted");
  assert.equal(batch!.stopped, `The disk is full: ${target}`);
  const outcomes = batch!.operations.map((op) => op.outcome);
  assert.equal(outcomes[second], "failed");
  assert.equal(batch!.operations[second]!.message, `The disk is full: ${target}`);
  assert.ok(outcomes.slice(second + 1).every((outcome) => outcome === "pending"), outcomes.join());
  assert.ok(outcomes.slice(0, second).every((outcome) => outcome === "done" || outcome === "skipped"), outcomes.join());
  // The poster that could not be fetched did not stop the batch, and says why it is missing.
  const poster = batch!.operations.find((op) => op.type === "download");
  if (types.indexOf("download") < second)
    assert.deepEqual([poster!.outcome, poster!.message], ["skipped", "The image source could not be reached."]);
  await undoBatch(lib.plan.id, lib.journals);
  assert.equal((await history(lib.journals))[0]!.status, "undone");
});

test("history tells a batch the app died in from one that failed, and a finished one has no reason", async (t) => {
  const lib = await filmBatch(t);
  const result = await applyPlan(lib.plan, lib.journals, { ...offline, link: fs.link, rename: fs.rename });
  assert.equal(result.warnings.length, 1);
  let [batch] = await history(lib.journals);
  assert.equal(batch!.status, "complete");
  assert.equal(batch!.stopped, undefined);
  assert.deepEqual(
    Object.groupBy(batch!.operations, (op) => op.outcome).skipped?.map((op) => op.type),
    ["download"],
  );
  assert.ok(batch!.operations.every((op) => op.outcome === "done" || op.outcome === "skipped"));

  // The same record cut off after a change was announced, as a crash leaves it.
  const journal = path.join(lib.journals, `${lib.plan.id}.jsonl`);
  const lines = (await fs.readFile(journal, "utf8")).split("\n").filter(Boolean);
  const cut = lines.findLastIndex((line) => line.includes('"intent"'));
  const index = JSON.parse(lines[cut]!).index as number;
  await fs.writeFile(journal, lines.slice(0, cut + 1).join("\n") + "\n");
  [batch] = await history(lib.journals);
  assert.equal(batch!.status, "interrupted");
  assert.equal(batch!.stopped, "The app closed before the batch finished.");
  assert.deepEqual(
    [batch!.operations[index]!.outcome, batch!.operations[index]!.message],
    ["failed", "The app closed before the batch finished."],
  );
});

const roomy: RoomProbe = { access: fs.access, statfs: fs.statfs };

test("a plan is checked for somewhere to go before anything moves", async (t) => {
  const lib = await filmBatch(t);
  assert.deepEqual(await checkRoom(lib.plan, lib.journals), []);

  const full: RoomProbe = {
    ...roomy,
    statfs: async (...args: Parameters<typeof fs.statfs>) => ({ ...(await fs.statfs(...args)), bavail: 0 }),
  } as RoomProbe;
  const problems = await checkRoom(lib.plan, lib.journals, full);
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0]!, /^Not enough room on the disk holding .+: this batch writes about 3 MB and under 1 MB is free\.$/);

  const readOnly: RoomProbe = {
    ...roomy,
    access: async (target) => {
      if (String(target) === lib.dir) throw fail("EROFS", "EROFS: read-only file system, access", lib.dir);
    },
  } as RoomProbe;
  assert.deepEqual(await checkRoom(lib.plan, lib.journals, readOnly), [`${lib.dir} is on a read-only disk.`]);

  const noHistory: RoomProbe = {
    ...roomy,
    access: async (target) => {
      if (String(target) === lib.journals) throw fail("EACCES", "EACCES: permission denied, access", lib.journals);
    },
  } as RoomProbe;
  assert.deepEqual(await checkRoom(lib.plan, lib.journals, noHistory), [
    `The history folder cannot be changed. Permission was denied: ${lib.journals}`,
  ]);

  // A drive that reports no size is not called full.
  const silent: RoomProbe = {
    ...roomy,
    statfs: async (...args: Parameters<typeof fs.statfs>) => ({ ...(await fs.statfs(...args)), blocks: 0, bavail: 0 }),
  } as RoomProbe;
  assert.deepEqual(await checkRoom(lib.plan, lib.journals, silent), []);
});

test("a batch headed for a folder that cannot be changed is refused before it starts", async (t) => {
  const lib = await filmBatch(t);
  const journals = await fs.mkdtemp(path.join(os.tmpdir(), "organtic-history-"));
  t.after(() => fs.rm(journals, { recursive: true, force: true }));
  await fs.chmod(lib.dir, 0o500);
  const writable = await fs.access(lib.dir, fs.constants.W_OK).then(() => true, () => false);
  const refused = await applyPlan(lib.plan, journals).then(
    () => null,
    (error: Error) => error,
  );
  await fs.chmod(lib.dir, 0o700);
  if (writable) return t.skip("folder permissions are not enforced here");
  assert.match(refused?.message ?? "", /cannot be changed\. Permission was denied/);
  // Nothing was recorded, because nothing was attempted.
  assert.deepEqual(await fs.readdir(journals), []);
});
