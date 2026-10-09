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
  undoBatch,
  history,
} from "../core/files.ts";
import type { Media, PlanOptions, Selection } from "../core/types.ts";
const media: Media = {
  kind: "movie",
  title: "Arrival",
  year: 2016,
  provider: "tmdb",
  id: 329865,
  overview: "Hello",
};
// Most tests exercise renaming within the file's own folder.
const planInPlace = (selections: Selection[], options: PlanOptions = {}) =>
  createPlan(selections, { organize: false, ...options });
async function fixture(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "organtic-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "Arrival.2016.1080p.mkv");
  await fs.writeFile(source, "untouched video bytes");
  const { files } = await scanPaths([source]);
  return { dir, source, file: files[0], journals: path.join(dir, "journals") };
}
test("renames video and language subtitles, creates metadata, and undoes after restart", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.dir, "Arrival.2016.1080p.en.forced.srt"),
    "subtitle",
  );
  const plan = await planInPlace([{ file: f.file, media }], { nfo: true });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.operations.length, 3);
  await applyPlan(plan, f.journals);
  assert.equal(
    await fs.readFile(path.join(f.dir, "Arrival (2016).mkv"), "utf8"),
    "untouched video bytes",
  );
  assert.equal((await history(f.journals))[0].status, "complete");
  await undoBatch(plan.id, f.journals);
  assert.equal(await fs.readFile(f.source, "utf8"), "untouched video bytes");
  assert.equal(
    await fs.readFile(
      path.join(f.dir, "Arrival.2016.1080p.en.forced.srt"),
      "utf8",
    ),
    "subtitle",
  );
  await assert.rejects(fs.stat(path.join(f.dir, "Arrival (2016).nfo")), {
    code: "ENOENT",
  });
  assert.equal((await history(f.journals))[0].status, "undone");
});
test("existing destinations and duplicate target names block entire batch", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dir, "ARRIVAL (2016).MKV"), "existing");
  const plan = await planInPlace([{ file: f.file, media }]);
  assert.match(plan.errors.join(), /already exists/);
  await assert.rejects(applyPlan(plan, f.journals));
  assert.equal(await fs.readFile(f.source, "utf8"), "untouched video bytes");
  const duplicate = await planInPlace([
    { file: f.file, media },
    { file: f.file, media },
  ]);
  assert.match(duplicate.errors.join(), /same destination/);
});
test("revalidates source and target after preview", async (t) => {
  const f = await fixture(t);
  const plan = await planInPlace([{ file: f.file, media }]);
  await fs.writeFile(f.source, "changed");
  await assert.rejects(applyPlan(plan, f.journals), /source changed/);
  const fresh = await planInPlace([{ file: f.file, media }]);
  await fs.writeFile(fresh.operations[0]!.target, "do not overwrite");
  await assert.rejects(applyPlan(fresh, f.journals), /destination now exists/);
  assert.equal(
    await fs.readFile(fresh.operations[0]!.target, "utf8"),
    "do not overwrite",
  );
});
test("undo refuses modified destinations and metadata", async (t) => {
  const f = await fixture(t);
  const plan = await planInPlace([{ file: f.file, media }], { nfo: true });
  await applyPlan(plan, f.journals);
  const nfo = plan.operations.find((op) => op.type === "write")!;
  await fs.writeFile(nfo.target, "user changed metadata");
  await assert.rejects(undoBatch(plan.id, f.journals), /Metadata changed/);
  assert.equal(await fs.readFile(nfo.target, "utf8"), "user changed metadata");
});
test("recovers a journal interrupted between link and source removal", async (t) => {
  const f = await fixture(t);
  const plan = await planInPlace([{ file: f.file, media }]);
  await fs.mkdir(f.journals);
  await fs.writeFile(
    path.join(f.journals, `${plan.id}.jsonl`),
    JSON.stringify({ type: "plan", plan }) +
      "\n" +
      JSON.stringify({ type: "intent", index: 0 }) +
      "\n",
  );
  await fs.link(f.source, plan.operations[0]!.target);
  assert.equal((await history(f.journals))[0].status, "interrupted");
  await undoBatch(plan.id, f.journals);
  assert.equal(await fs.readFile(f.source, "utf8"), "untouched video bytes");
  await assert.rejects(fs.stat(plan.operations[0]!.target), { code: "ENOENT" });
});
test("recovery does not overwrite an occupied original path", async (t) => {
  const f = await fixture(t);
  const plan = await planInPlace([{ file: f.file, media }]);
  await applyPlan(plan, f.journals);
  await fs.writeFile(f.source, "new file");
  await assert.rejects(
    undoBatch(plan.id, f.journals),
    /Original path is occupied/,
  );
  assert.equal(await fs.readFile(f.source, "utf8"), "new file");
});
test("scanner excludes symlinks and unrelated files", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dir, "notes.txt"), "skip");
  try {
    await fs.symlink(f.source, path.join(f.dir, "link.mkv"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EPERM")
      return t.skip("Windows requires symlink privileges");
    throw e;
  }
  const result = await scanPaths([f.dir, f.source]);
  assert.equal(result.files.length, 1);
  assert.equal(result.skipped.length, 1);
});
test("unchanged names can still create NFO, and an NFO already beside the video is kept", async (t) => {
  const f = await fixture(t);
  await fs.rename(f.source, path.join(f.dir, "Arrival (2016).mkv"));
  const { files } = await scanPaths([f.dir]);
  const plan = await planInPlace([{ file: files[0]!, media }], { nfo: true });
  assert.equal(plan.operations.length, 1);
  assert.deepEqual(plan.errors, []);
  await applyPlan(plan, f.journals);
  // Planning the same library again has nothing to write and nothing to clash with.
  const again = await planInPlace([{ file: files[0]!, media }], { nfo: true });
  assert.deepEqual(again.operations, []);
  assert.deepEqual(again.issues, []);
  assert.deepEqual(again.errors, ["These files already have their proposed names."]);
  // A video on its way to a name whose NFO is already there moves without writing another.
  await fs.rename(path.join(f.dir, "Arrival (2016).mkv"), f.source);
  const moving = await planInPlace([{ file: f.file, media }], { nfo: true });
  assert.deepEqual(moving.errors, []);
  assert.deepEqual(moving.operations.map((op) => op.type), ["move"]);
});

test("two copies of a film in different formats share one written NFO", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dir, "Arrival.2016.720p.avi"), "another copy");
  const { files } = await scanPaths([f.dir]);
  const plan = await planInPlace(files.map((file) => ({ file, media })), { nfo: true });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(
    plan.operations.map((op) => `${op.type} ${path.basename(op.target)}`).sort(),
    ["move Arrival (2016).avi", "move Arrival (2016).mkv", "write Arrival (2016).nfo"],
  );
});

test("recovers an incomplete final journal record without corrupting later events", async (t) => {
  const f = await fixture(t);
  const plan = await planInPlace([{ file: f.file, media }]);
  await applyPlan(plan, f.journals);
  await fs.appendFile(path.join(f.journals, `${plan.id}.jsonl`), '{"type":');
  await undoBatch(plan.id, f.journals);
  assert.equal((await history(f.journals))[0].status, "undone");
  assert.equal(await fs.readFile(f.source, "utf8"), "untouched video bytes");
});
test("case-only renames and Unicode-equivalent destinations are blocked", async (t) => {
  const f = await fixture(t);
  await fs.rename(f.source, path.join(f.dir, "arrival (2016).mkv"));
  const { files } = await scanPaths([f.dir]);
  const plan = await planInPlace([{ file: files[0]!, media }]);
  assert.match(plan.errors.join(), /already exists/);
  await fs.writeFile(path.join(f.dir, "Cafe\u0301 (2016).mkv"), "existing");
  const unicodePlan = await planInPlace([
    { file: files[0]!, media: { ...media, title: "Café" } },
  ]);
  assert.match(unicodePlan.errors.join(), /already exists/);
});
test('metadata-only plans still revalidate their video source', async t => {
  const f = await fixture(t);
  const named = path.join(f.dir, 'Arrival (2016).mkv');
  await fs.rename(f.source, named);
  const { files } = await scanPaths([named]);
  const plan = await planInPlace([{ file: files[0]!, media }], { nfo: true });
  await fs.writeFile(named, 'replacement video');
  await assert.rejects(applyPlan(plan, f.journals), /source changed/);
  await assert.rejects(fs.stat(path.join(f.dir, 'Arrival (2016).nfo')), { code: 'ENOENT' });
});

const episode = (number: number, title: string, extra: Partial<Media> = {}): Media => ({
  kind: "tv",
  title: "Severance",
  year: 2022,
  provider: "tmdb",
  id: 95396,
  overview: "",
  season: 1,
  episode: number,
  episodeTitle: title,
  ...extra,
});
async function library(t: TestContext, names: string[]) {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "organtic-")),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const name of names) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), `bytes of ${name}`);
  }
  const { files } = await scanPaths([dir]);
  const byName = (name: string) =>
    files.find((file) => file.path === path.join(dir, name))!;
  return { dir, files, byName, journals: path.join(dir, ".journals") };
}
async function tree(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.parentPath.includes(".journals"))
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, "/"),
    )
    .sort();
}

test("organises a messy download into Plex folders and undoes it completely", async (t) => {
  const messy = [
    "Severance.S01.1080p.WEB-DL-GRP/Severance.S01E01.1080p.WEB-DL-GRP.mkv",
    "Severance.S01.1080p.WEB-DL-GRP/Severance.S01E01.1080p.WEB-DL-GRP.en.srt",
    "Severance.S01.1080p.WEB-DL-GRP/Severance.S01E02E03.1080p.WEB-DL-GRP.mkv",
    "Arrival.2016.1080p.BluRay-GRP/arrival-grp.mkv",
  ];
  const lib = await library(t, messy);
  const double = lib.byName(messy[2]!);
  assert.equal(double.parsed.episodeEnd, 3);
  const plan = await createPlan([
    { file: lib.byName(messy[0]!), media: episode(1, "Good News About Hell") },
    {
      file: double,
      media: episode(2, "Half Loop & In Perpetuity", { episodeEnd: 3 }),
    },
    { file: lib.byName(messy[3]!), media },
  ]);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(
    plan.operations.map((op) => op.type),
    ["mkdir", "mkdir", "mkdir", "move", "move", "move", "move", "rmdir", "rmdir"],
  );
  await applyPlan(plan, lib.journals);
  const show = "Severance (2022) {tmdb-95396}/Season 01/Severance (2022) - ";
  assert.deepEqual(await tree(lib.dir), [
    "Arrival (2016) {tmdb-329865}/Arrival (2016).mkv",
    `${show}S01E01 - Good News About Hell.en.srt`,
    `${show}S01E01 - Good News About Hell.mkv`,
    `${show}S01E02-E03 - Half Loop & In Perpetuity.mkv`,
  ]);
  // Both release folders were emptied, so they are gone.
  assert.deepEqual((await fs.readdir(lib.dir)).filter((n) => n !== ".journals").sort(), [
    "Arrival (2016) {tmdb-329865}",
    "Severance (2022) {tmdb-95396}",
  ]);
  await undoBatch(plan.id, lib.journals);
  assert.deepEqual(await tree(lib.dir), [...messy].sort());
  // Folders the batch created are removed again; the originals were never touched.
  assert.deepEqual((await fs.readdir(lib.dir)).filter((n) => n !== ".journals").sort(), [
    "Arrival.2016.1080p.BluRay-GRP",
    "Severance.S01.1080p.WEB-DL-GRP",
  ]);
});

test("reuses an existing show folder that differs only by case, and keeps it on undo", async (t) => {
  const lib = await library(t, [
    "severance (2022) {tmdb-95396}/Season 01/keep.txt",
    "Severance.S01E01.mkv",
  ]);
  const plan = await createPlan([
    { file: lib.byName("Severance.S01E01.mkv"), media: episode(1, "Pilot") },
  ]);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(
    plan.operations.map((op) => op.type),
    ["move"],
  );
  await applyPlan(plan, lib.journals);
  const moved =
    "severance (2022) {tmdb-95396}/Season 01/Severance (2022) - S01E01 - Pilot.mkv";
  assert.ok((await tree(lib.dir)).includes(moved));
  await undoBatch(plan.id, lib.journals);
  assert.deepEqual(await tree(lib.dir), [
    "Severance.S01E01.mkv",
    "severance (2022) {tmdb-95396}/Season 01/keep.txt",
  ]);
});

test("a file in the way of a planned folder blocks the plan", async (t) => {
  const lib = await library(t, ["Arrival.2016.mkv", "Arrival (2016) {tmdb-329865}"]);
  const plan = await createPlan([{ file: lib.byName("Arrival.2016.mkv"), media }]);
  assert.match(plan.errors.join(), /in the way/);
});

test("two files resolving to one episode are reported, not overwritten", async (t) => {
  const lib = await library(t, ["a/Severance.S01E01.mkv", "b/Severance.S01E01.mkv"]);
  const plan = await createPlan(
    lib.files.map((file) => ({ file, media: episode(1, "Pilot") })),
  );
  assert.match(plan.errors.join(), /same destination/);
  await assert.rejects(applyPlan(plan, lib.journals));
});

test("falls back to a guarded rename where hard links are unsupported", async (t) => {
  const f = await fixture(t);
  const noLinks = {
    link: async () => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    },
    rename: fs.rename,
  };
  const plan = await createPlan([{ file: f.file, media }]);
  await applyPlan(plan, f.journals, noLinks);
  const target = path.join(f.dir, "Arrival (2016) {tmdb-329865}/Arrival (2016).mkv");
  assert.equal(await fs.readFile(target, "utf8"), "untouched video bytes");
  await assert.rejects(fs.stat(f.source), { code: "ENOENT" });
  await undoBatch(plan.id, f.journals, noLinks);
  assert.equal(await fs.readFile(f.source, "utf8"), "untouched video bytes");

  // The fallback still refuses to replace a file that appeared after the preview checks.
  const again = await planInPlace([{ file: f.file, media }]);
  const occupied = again.operations[0]!.target;
  const racing = {
    link: async () => {
      await fs.writeFile(occupied, "someone else's file");
      throw Object.assign(new Error("not supported"), { code: "ENOTSUP" });
    },
    rename: fs.rename,
  };
  await assert.rejects(applyPlan(again, f.journals, racing), /already exists/);
  assert.equal(await fs.readFile(occupied, "utf8"), "someone else's file");
  assert.equal(await fs.readFile(f.source, "utf8"), "untouched video bytes");
});

test("removes only the source folders a batch truly empties", async (t) => {
  const lib = await library(t, [
    "Severance/Season 1/Severance.S01E01.mkv",
    "Kept/Season 1/Severance.S01E02.mkv",
    "Kept/Season 1/notes.txt",
    "Hidden/Severance.S01E04.mkv",
    "Hidden/.nomedia",
    "Severance (2022) {tmdb-95396}/S1/Severance.S01E05.mkv",
  ]);
  const titles: Record<string, number> = { E01: 1, E02: 2, E04: 4, E05: 5 };
  const selections = lib.files.map((file) => {
    const number = titles[/E0\d/.exec(file.name)![0]]!;
    return { file, media: episode(number, `Part ${number}`) };
  });
  const rmdirs = (plan: { operations: { type: string; target: string }[] }) =>
    plan.operations
      .filter((op) => op.type === "rmdir")
      .map((op) => path.relative(lib.dir, op.target).replaceAll(path.sep, "/"));

  const plan = await createPlan(selections);
  assert.deepEqual(plan.errors, []);
  // Children before parents; a folder with a leftover or hidden file, a folder that
  // receives files, and the imported folder itself all stay.
  assert.deepEqual(rmdirs(plan), [
    "Severance (2022) {tmdb-95396}/S1",
    "Severance/Season 1",
    "Severance",
  ]);
  assert.deepEqual(rmdirs(await createPlan(selections, { removeEmpty: false })), []);
  // A file added on its own never has its folder removed, however empty it ends up.
  const single = await scanPaths([path.join(lib.dir, "Severance/Season 1/Severance.S01E01.mkv")]);
  assert.deepEqual(rmdirs(await createPlan([{ file: single.files[0]!, media: episode(1, "Part 1") }])), []);

  // Something appears in a doomed folder after the preview: it is left alone, not an error.
  await fs.writeFile(path.join(lib.dir, "Severance/Season 1/late.txt"), "arrived late");
  await applyPlan(plan, lib.journals);
  const folders = async () =>
    (await fs.readdir(lib.dir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.parentPath.includes(".journals") && entry.name !== ".journals")
      .map((entry) => path.relative(lib.dir, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, "/"))
      .sort();
  assert.deepEqual(await folders(), [
    "Hidden",
    "Kept",
    "Kept/Season 1",
    "Severance",
    "Severance (2022) {tmdb-95396}",
    "Severance (2022) {tmdb-95396}/Season 01",
    "Severance/Season 1",
  ]);
  await undoBatch(plan.id, lib.journals);
  assert.ok((await folders()).includes("Severance (2022) {tmdb-95396}/S1"));
  await fs.access(path.join(lib.dir, "Severance (2022) {tmdb-95396}/S1/Severance.S01E05.mkv"));
  await fs.access(path.join(lib.dir, "Severance/Season 1/Severance.S01E01.mkv"));
});

test("downloads posters and backdrops into title folders without replacing or failing the batch", async (t) => {
  const lib = await library(t, [
    "Severance.S01E01.mkv",
    "Severance.S01E02.mkv",
    "Arrival.2016.mkv",
    "Dune.2021.mkv",
    "Dune (2021) {tmdb-438631}/Poster.PNG",
  ]);
  const art = (name: string) => ({
    posterUrl: `https://image.tmdb.org/t/p/original/${name}-poster.jpg`,
    backdropUrl: `https://image.tmdb.org/t/p/original/${name}-backdrop.png`,
  });
  const selections = [
    { file: lib.byName("Severance.S01E01.mkv"), media: episode(1, "One", art("severance")) },
    { file: lib.byName("Severance.S01E02.mkv"), media: episode(2, "Two", art("severance")) },
    { file: lib.byName("Arrival.2016.mkv"), media: { ...media, ...art("arrival"), backdropUrl: "https://evil.example/x.jpg" } },
    { file: lib.byName("Dune.2021.mkv"), media: { ...media, title: "Dune", year: 2021, id: 438631, ...art("dune") } },
  ];
  const downloads = (plan: { operations: { type: string; target: string }[] }) =>
    plan.operations
      .filter((op) => op.type === "download")
      .map((op) => path.relative(lib.dir, op.target).replaceAll(path.sep, "/"));

  assert.deepEqual(downloads(await createPlan(selections)), []);
  assert.deepEqual(downloads(await createPlan(selections, { artwork: true, organize: false })), []);
  const plan = await createPlan(selections, { artwork: true });
  assert.deepEqual(plan.errors, []);
  // Once per title folder; an address from an unknown host is ignored; Dune already has a poster.
  assert.deepEqual(downloads(plan), [
    "Severance (2022) {tmdb-95396}/poster.jpg",
    "Severance (2022) {tmdb-95396}/fanart.png",
    "Arrival (2016) {tmdb-329865}/poster.jpg",
    "Dune (2021) {tmdb-438631}/fanart.png",
  ]);

  const requested: string[] = [];
  const io = {
    link: fs.link,
    rename: fs.rename,
    fetch: (async (url: string) => {
      requested.push(url);
      if (url.includes("arrival")) return new Response("", { status: 404 });
      if (url.includes("dune"))
        return new Response("<html>not an image</html>", { headers: { "content-type": "text/html" } });
      return new Response(`image bytes for ${url}`, { headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch,
  };
  const result = await applyPlan(plan, lib.journals, io);
  assert.equal(requested.length, 4);
  assert.deepEqual(result.warnings, [
    "poster.jpg: The image source returned HTTP 404.",
    "fanart.png: The source did not return an image.",
  ]);
  // Every rename still happened, and only the two good images were saved.
  assert.equal(result.completed, plan.operations.length - 2);
  const files = await tree(lib.dir);
  assert.ok(files.includes("Arrival (2016) {tmdb-329865}/Arrival (2016).mkv"));
  assert.deepEqual(files.filter((name) => /poster|fanart/i.test(name)), [
    "Dune (2021) {tmdb-438631}/Poster.PNG",
    "Severance (2022) {tmdb-95396}/fanart.png",
    "Severance (2022) {tmdb-95396}/poster.jpg",
  ]);
  assert.equal((await history(lib.journals))[0]!.status, "complete");

  // Undo removes the images it saved, except one that has since been replaced by hand.
  await fs.writeFile(path.join(lib.dir, "Severance (2022) {tmdb-95396}/poster.jpg"), "my own poster, a different size");
  await undoBatch(plan.id, lib.journals);
  assert.deepEqual(await tree(lib.dir), [
    "Arrival.2016.mkv",
    "Dune (2021) {tmdb-438631}/Poster.PNG",
    "Dune.2021.mkv",
    "Severance (2022) {tmdb-95396}/poster.jpg",
    "Severance.S01E01.mkv",
    "Severance.S01E02.mkv",
  ]);
});

test("downloads one poster per season beside its episodes", async (t) => {
  const lib = await library(t, [
    "Severance.S01E01.mkv",
    "Severance.S01E02.mkv",
    "Severance.S02E01.mkv",
    "Severance.S00E01.mkv",
    "Severance.S03E01.mkv",
    "Severance (2022) {tmdb-95396}/Season 03/Season03.png",
  ]);
  const poster = (season: number) => ({
    season,
    seasonPosterUrl: `https://image.tmdb.org/t/p/original/s${season}.jpg`,
  });
  const selections = [
    { file: lib.byName("Severance.S01E01.mkv"), media: episode(1, "One", poster(1)) },
    { file: lib.byName("Severance.S01E02.mkv"), media: episode(2, "Two", poster(1)) },
    { file: lib.byName("Severance.S02E01.mkv"), media: episode(1, "Three", poster(2)) },
    { file: lib.byName("Severance.S00E01.mkv"), media: episode(1, "Special", poster(0)) },
    { file: lib.byName("Severance.S03E01.mkv"), media: episode(1, "Four", poster(3)) },
  ];
  const downloads = (plan: { operations: { type: string; target: string }[] }) =>
    plan.operations
      .filter((op) => op.type === "download")
      .map((op) => path.relative(lib.dir, op.target).replaceAll(path.sep, "/"));
  const show = "Severance (2022) {tmdb-95396}";
  // Once per season; season 3 already has a poster under Plex's other name.
  assert.deepEqual(downloads(await createPlan(selections, { artwork: true })), [
    `${show}/Season 01/season01-poster.jpg`,
    `${show}/Season 02/season02-poster.jpg`,
    `${show}/Season 00/season-specials-poster.jpg`,
  ]);
  // A layout without season folders puts them in the show folder, where the names still differ.
  const flat = await createPlan(selections.slice(0, 3), {
    artwork: true,
    templates: { movie: "{title}", episode: "{title}/{title} S{season:00}E{episode:00}" },
  });
  assert.deepEqual(downloads(flat), ["Severance/season01-poster.jpg", "Severance/season02-poster.jpg"]);
  assert.deepEqual(downloads(await createPlan(selections)), []);
});

test("existing NFO files and artwork move with their video or its folder", async (t) => {
  const lib = await library(t, [
    // A film folder as another organiser would leave it.
    "Arrival.2016.1080p/Arrival.2016.1080p.mkv",
    "Arrival.2016.1080p/Arrival.2016.1080p.nfo",
    "Arrival.2016.1080p/Arrival.2016.1080p-poster.jpg",
    "Arrival.2016.1080p/Arrival.2016.1080p.en.srt",
    "Arrival.2016.1080p/poster.jpg",
    "Arrival.2016.1080p/fanart.jpg",
    "Arrival.2016.1080p/movie.nfo",
    "Arrival.2016.1080p/notes.txt",
    // A season folder: season artwork follows, show-level files do not.
    "Show/Season 1/Severance.S01E01.mkv",
    "Show/Season 1/Severance.S01E01-thumb.jpg",
    "Show/Season 1/season01-poster.jpg",
    "Show/Season 1/poster.jpg",
    // Two films in one folder: the folder's poster belongs to neither.
    "Mixed/Dune.2021.mkv",
    "Mixed/Dune.2021-2.mkv",
    "Mixed/Dune.2021-2-poster.jpg",
    "Mixed/poster.jpg",
    // The destination already has a poster; the incoming one stays behind.
    "Solaris.1972/Solaris.1972.mkv",
    "Solaris.1972/poster.jpg",
    "Solaris (1972) {tmdb-593}/poster.jpg",
  ]);
  const film = (title: string, year: number, id: number, extra: Partial<Media> = {}): Media => ({
    ...media, title, year, id, ...extra,
  });
  const selections = [
    { file: lib.byName("Arrival.2016.1080p/Arrival.2016.1080p.mkv"), media: film("Arrival", 2016, 329865, {
        posterUrl: "https://image.tmdb.org/t/p/original/p.jpg",
        backdropUrl: "https://image.tmdb.org/t/p/original/b.jpg",
      }) },
    { file: lib.byName("Show/Season 1/Severance.S01E01.mkv"), media: episode(1, "One", {
        seasonPosterUrl: "https://image.tmdb.org/t/p/original/s1.jpg",
      }) },
    { file: lib.byName("Mixed/Dune.2021.mkv"), media: film("Dune", 2021, 438631) },
    { file: lib.byName("Solaris.1972/Solaris.1972.mkv"), media: film("Solaris", 1972, 593) },
  ];
  const moved = async (options = {}) => {
    const plan = await createPlan(selections, { nfo: true, artwork: true, ...options });
    assert.deepEqual(plan.errors, []);
    return plan;
  };
  const plan = await moved();
  // Nothing is downloaded or written where an existing file is already on its way.
  assert.deepEqual(plan.operations.filter((op) => op.type === "download"), []);
  assert.deepEqual(
    plan.operations.filter((op) => op.type === "write").map((op) => path.basename(op.target)),
    ["Severance (2022) - S01E01 - One.nfo", "Dune (2021).nfo", "Solaris (1972).nfo"],
  );
  await applyPlan(plan, lib.journals);
  assert.deepEqual(await tree(lib.dir), [
    "Arrival (2016) {tmdb-329865}/Arrival (2016)-poster.jpg",
    "Arrival (2016) {tmdb-329865}/Arrival (2016).en.srt",
    "Arrival (2016) {tmdb-329865}/Arrival (2016).mkv",
    "Arrival (2016) {tmdb-329865}/Arrival (2016).nfo",
    "Arrival (2016) {tmdb-329865}/fanart.jpg",
    "Arrival (2016) {tmdb-329865}/movie.nfo",
    "Arrival (2016) {tmdb-329865}/poster.jpg",
    "Arrival.2016.1080p/notes.txt",
    "Dune (2021) {tmdb-438631}/Dune (2021).mkv",
    "Dune (2021) {tmdb-438631}/Dune (2021).nfo",
    "Mixed/Dune.2021-2-poster.jpg",
    "Mixed/Dune.2021-2.mkv",
    "Mixed/poster.jpg",
    "Severance (2022) {tmdb-95396}/Season 01/Severance (2022) - S01E01 - One-thumb.jpg",
    "Severance (2022) {tmdb-95396}/Season 01/Severance (2022) - S01E01 - One.mkv",
    "Severance (2022) {tmdb-95396}/Season 01/Severance (2022) - S01E01 - One.nfo",
    "Severance (2022) {tmdb-95396}/Season 01/season01-poster.jpg",
    "Show/Season 1/poster.jpg",
    "Solaris (1972) {tmdb-593}/Solaris (1972).mkv",
    "Solaris (1972) {tmdb-593}/Solaris (1972).nfo",
    "Solaris (1972) {tmdb-593}/poster.jpg",
    "Solaris.1972/poster.jpg",
  ]);
  await undoBatch(plan.id, lib.journals);
  assert.equal((await tree(lib.dir)).length, 19);
  await fs.access(path.join(lib.dir, "Arrival.2016.1080p/movie.nfo"));

  // Turned off, only the video and its subtitles move, and the gaps are filled as before.
  const without = await moved({ sidecars: false });
  assert.deepEqual(
    without.operations.filter((op) => op.type === "move").map((op) => path.extname(op.target)).sort(),
    [".mkv", ".mkv", ".mkv", ".mkv", ".srt"],
  );
  assert.equal(without.operations.filter((op) => op.type === "download").length, 3);
  assert.equal(without.operations.filter((op) => op.type === "write").length, 4);
});

test("a show's own files follow it only when the whole show is reorganised", async (t) => {
  const lib = await library(t, [
    // A whole show in season folders, as Kodi or another organiser would leave it.
    "Severance/tvshow.nfo",
    "Severance/poster.jpg",
    "Severance/fanart.jpg",
    "Severance/season01-poster.jpg",
    "Severance/notes.txt",
    "Severance/Season 1/Severance.S01E01.mkv",
    "Severance/Season 2/Severance.S02E01.mkv",
    // Episodes directly in the show folder.
    "Flat Show/tvshow.nfo",
    "Flat Show/banner.jpg",
    "Flat Show/The.Bear.S01E01.mkv",
    // Only part of this show is in the batch.
    "Partial/tvshow.nfo",
    "Partial/poster.jpg",
    "Partial/Season 1/Andor.S01E01.mkv",
    "Partial/Season 1/Andor.S01E02.mkv",
  ]);
  const show = (title: string, id: number, season: number, number: number): Media =>
    episode(number, "Part", { title, id, season, posterUrl: `https://image.tmdb.org/t/p/original/${id}.jpg` });
  const selections = [
    { file: lib.byName("Severance/Season 1/Severance.S01E01.mkv"), media: show("Severance", 95396, 1, 1) },
    { file: lib.byName("Severance/Season 2/Severance.S02E01.mkv"), media: show("Severance", 95396, 2, 1) },
    { file: lib.byName("Flat Show/The.Bear.S01E01.mkv"), media: show("The Bear", 136315, 1, 1) },
    { file: lib.byName("Partial/Season 1/Andor.S01E01.mkv"), media: show("Andor", 83867, 1, 1) },
  ];
  const plan = await createPlan(selections, { artwork: true });
  assert.deepEqual(plan.errors, []);
  // Severance brings its own poster, so only the other two shows get one downloaded.
  assert.deepEqual(
    plan.operations.filter((op) => op.type === "download").map((op) => path.relative(lib.dir, op.target).replaceAll(path.sep, "/")),
    ["The Bear (2022) {tmdb-136315}/poster.jpg", "Andor (2022) {tmdb-83867}/poster.jpg"],
  );
  await applyPlan(plan, lib.journals, {
    link: fs.link,
    rename: fs.rename,
    fetch: (async () => new Response("image", { headers: { "content-type": "image/jpeg" } })) as typeof fetch,
  });
  const after = await tree(lib.dir);
  const sev = "Severance (2022) {tmdb-95396}";
  for (const name of ["tvshow.nfo", "poster.jpg", "fanart.jpg", "season01-poster.jpg"])
    assert.ok(after.includes(`${sev}/${name}`), name);
  assert.ok(after.includes("Severance/notes.txt"));
  assert.ok(after.includes("The Bear (2022) {tmdb-136315}/tvshow.nfo"));
  assert.ok(after.includes("The Bear (2022) {tmdb-136315}/banner.jpg"));
  // The emptied flat show folder is gone; the partly reorganised show keeps its files.
  assert.ok(!after.some((name) => name.startsWith("Flat Show/")));
  assert.ok(after.includes("Partial/tvshow.nfo") && after.includes("Partial/poster.jpg"));
  assert.ok(after.includes("Partial/Season 1/Andor.S01E02.mkv"));

  await undoBatch(plan.id, lib.journals);
  const restored = await tree(lib.dir);
  assert.equal(restored.length, 14);
  assert.ok(restored.includes("Severance/tvshow.nfo") && restored.includes("Flat Show/banner.jpg"));

  // Turned off, show files stay put.
  const without = await createPlan(selections, { sidecars: false });
  assert.ok(!without.operations.some((op) => op.type === "move" && /tvshow|poster|fanart|banner/.test(op.target)));
});
