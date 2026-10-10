import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyPlan, createPlan, scanPaths } from "../core/files.ts";
import { Providers } from "../core/providers.ts";
import { Session } from "../core/session.ts";
import { DEFAULT_SETTINGS, mergeSettings } from "../core/settings.ts";
import type { AppSettings, QueueState } from "../core/types.ts";

// A tiny TMDB: two shows, two films sharing a title, and one film.
// The other sources answer, with nothing.
const elsewhere = (url: URL) =>
  url.hostname === "api.themoviedb.org"
    ? null
    : Response.json(url.hostname === "kitsu.io" ? { data: [] } : []);
const tmdb = async (url: URL) => {
  const other = elsewhere(url);
  if (other) return other;
  const query = (url.searchParams.get("query") ?? "").toLowerCase();
  const year = url.searchParams.get("year");
  const at = url.pathname.replace("/3/", "");
  if (at === "search/tv")
    return Response.json({
      results: [
        { id: 95396, name: "Severance", first_air_date: "2022-02-17" },
        { id: 209867, name: "Frieren: Beyond Journey's End", first_air_date: "2023-09-29" },
      ].filter((show) => (query.includes("frieren") ? show.id === 209867 : show.name.toLowerCase() === query)),
    });
  if (at === "search/movie")
    return Response.json({
      results: [
        { id: 593, title: "Solaris", release_date: "1972-03-20" },
        { id: 2103, title: "Solaris", release_date: "2002-11-27" },
        { id: 329865, title: "Arrival", release_date: "2016-11-10" },
      ].filter((film) => film.title.toLowerCase() === query && (!year || film.release_date.startsWith(year))),
    });
  if (/^tv\/\d+$/.test(at)) return Response.json({ seasons: [{ season_number: 1, episode_count: 3 }] });
  const season = /^tv\/(\d+)\/season\/(\d+)$/.exec(at);
  if (season && season[2] === "1")
    return Response.json({
      episodes: [1, 2, 3].map((number) => ({ id: number, episode_number: number, name: `Part ${number}` })),
    });
  return new Response("", { status: 404 });
};

async function setup(t: TestContext, names: string[], settings: Partial<AppSettings> = {}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "organtic-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const name of names) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), `bytes of ${name}`);
  }
  const providers = new Providers({ fetcher: tmdb });
  providers.setToken("test");
  const states: QueueState[] = [];
  const session = new Session({
    providers,
    settings: mergeSettings(settings),
    planner: { createPlan, applyPlan: (plan) => applyPlan(plan, path.join(dir, ".journals")) },
    onChange: (state) => states.push(state),
  });
  await session.addFiles(await scanPaths([dir]));
  const group = (title: string) => session.state().groups.find((g) => g.parsedTitle === title)!;
  return { dir, session, states, group };
}

test("groups a folder, suggests confident matches and flags the rest", async (t) => {
  const { session, states, group, dir } = await setup(t, [
    "Severance.S01E01.1080p.mkv",
    "Severance.S01E02E03.1080p.mkv",
    "Severance.S01E09.1080p.mkv",
    "[SubsPlease] Sousou no Frieren - 02 (1080p) [ABCD1234].mkv",
    "Solaris.mkv",
    "Arrival.2016.1080p.mkv",
    "Arrival.2016-sample.mkv",
  ]);
  assert.ok(states.some((state) => state.groups.some((g) => g.status === "matching")));
  const state = session.state();
  assert.equal(state.destination, dir);
  assert.deepEqual(state.skipped.map((file) => file.source), ["Arrival.2016-sample.mkv"]);

  const severance = group("Severance");
  assert.equal(severance.status, "suggested");
  assert.match(severance.reason, /Exact title\. 1 file could not be matched/);
  assert.deepEqual(
    severance.files.map((file) => [file.label, file.target ?? file.issue]),
    [
      ["S01E01", "Severance (2022)/Season 01/Severance (2022) - S01E01 - Part 1.mkv"],
      ["S01E02-E03", "Severance (2022)/Season 01/Severance (2022) - S01E02-E03 - Part 2 & Part 3.mkv"],
      ["S01E09", "Season 1 episode 9 was not found for this show."],
    ],
  );

  // The filename's title differs from the provider's, so it is offered but not trusted.
  const frieren = group("Sousou no Frieren");
  assert.equal(frieren.status, "review");
  assert.equal(frieren.files[0]!.label, "#2 → S01E02");
  assert.match(frieren.reason, /closest result.*counted from the start/);

  // Two films with the same exact title and no year: nothing is pre-selected.
  const solaris = group("Solaris");
  assert.equal(solaris.status, "unmatched");
  assert.equal(solaris.chosen, null);
  assert.equal(solaris.candidates.length, 2);
  assert.equal(solaris.files[0]!.target, null);

  assert.equal(group("Arrival").candidates[0]!.fit, "Exact title, year matches");
});

test("confirming, previewing and applying renames files and keeps the rest of the queue", async (t) => {
  const { session, group, dir } = await setup(t, [
    "Severance.S01E01.mkv",
    "Severance.S01E01.en.srt",
    "Severance.S01E09.mkv",
    "Arrival.2016.2160p.mkv",
    "Arrival.2016.1080p.mkv",
    "Solaris.mkv",
  ]);
  await assert.rejects(session.preview(), /Confirm at least one group/);
  session.confirmSuggested();
  assert.equal(group("Arrival").status, "confirmed");

  // Both Arrival files resolve to one name; the lesser copy is named as another version.
  const clash = await session.preview();
  assert.equal(clash.blocked, false);
  const arrival = clash.groups.find((g) => g.title === "Arrival")!;
  assert.deepEqual(
    arrival.items.map((item) => [item.from, item.to.split("/").at(-1), item.problem, item.note]),
    [
      ["Arrival.2016.1080p.mkv", "Arrival (2016) - 1080p.mkv", null, 'named as another version of "Arrival.2016.2160p.mkv"'],
      ["Arrival.2016.2160p.mkv", "Arrival (2016).mkv", null, null],
    ],
  );
  session.exclude(arrival.items[1]!.fileId, true);
  await assert.rejects(session.apply(clash.id), /queue changed/);

  const preview = await session.preview();
  assert.equal(preview.blocked, false);
  assert.deepEqual(preview.counts, { videos: 2, subtitles: 1, metadata: 0, artwork: 0, folders: 3, removed: 0, renamed: 0, left: 2, operations: 6 });
  assert.deepEqual(preview.newFolders, [
    "Arrival (2016)",
    "Severance (2022)",
    "Severance (2022)/Season 01",
  ]);
  const severance = preview.groups.find((g) => g.title === "Severance")!;
  assert.deepEqual(severance.left, ["Severance.S01E09.mkv"]);
  assert.deepEqual(
    severance.items.map((item) => [item.kind, item.from]),
    [["video", "Severance.S01E01.mkv"], ["subtitle", "Severance.S01E01.en.srt"]],
  );

  assert.deepEqual(await session.apply(preview.id), { id: preview.id, completed: 6, warnings: [], renamed: [] });
  await fs.access(path.join(dir, "Severance (2022)/Season 01/Severance (2022) - S01E01 - Part 1.en.srt"));
  await fs.access(path.join(dir, "Arrival (2016)/Arrival (2016).mkv"));
  // Unconfirmed and left-out files are still queued.
  assert.deepEqual(
    session.state().groups.map((g) => [g.parsedTitle, g.status, g.files.length]),
    [["Arrival", "review", 1], ["Severance", "review", 1], ["Solaris", "unmatched", 1]],
  );
});

test("choosing, searching again and changing settings update the queue", async (t) => {
  const { session, group } = await setup(t, ["Solaris.mkv", "Movies/Arival.2016.mkv"]);
  await session.choose(group("Solaris").key, 1);
  assert.equal(group("Solaris").status, "confirmed");
  assert.equal(group("Solaris").files[0]!.target, "Solaris (2002)/Solaris (2002).mkv");

  const typo = group("Arival");
  assert.equal(typo.status, "unmatched");
  assert.match(typo.reason, /No results/);
  await session.search(typo.key, { query: "Arrival", kind: "movie" });
  assert.equal(group("Arival").status, "suggested");

  session.updateSettings(mergeSettings({ preset: "jellyfin", organize: false }));
  assert.equal(group("Arival").files[0]!.target, "Movies/Arrival (2016).mkv");
  session.updateSettings(mergeSettings({ preset: "jellyfin" }));
  assert.equal(group("Arival").files[0]!.target, "Arrival (2016) [tmdbid-329865]/Arrival (2016).mkv");

  session.remove(group("Solaris").key);
  assert.equal(session.state().groups.length, 1);
  session.clear();
  assert.deepEqual(session.state(), { groups: [], skipped: [], destination: "", destinationChanged: false, lookups: null });
});

test("films need a TMDB token, extras can be included, and the destination can change", async (t) => {
  const { session, group, dir } = await setup(t, ["in/Arrival.2016.mkv", "in/Arrival.2016-sample.mkv"]);
  await session.include(session.state().skipped[0]!.id);
  assert.equal(session.state().skipped.length, 0);
  assert.equal(group("Arrival").files.length, 2);

  session.confirmSuggested();
  session.exclude(group("Arrival").files[1]!.id, true);
  await fs.mkdir(path.join(dir, "library"));
  session.setDestination(path.join(dir, "library"));
  const preview = await session.preview();
  assert.equal(preview.destination, path.join(dir, "library"));
  // "in" still holds the excluded sample, so it stays.
  assert.deepEqual(preview.removedFolders, []);
  await session.apply(preview.id);
  await fs.access(path.join(dir, "library/Arrival (2016)/Arrival (2016).mkv"));

  const offline = new Session({
    providers: new Providers({ fetcher: tmdb }),
    settings: DEFAULT_SETTINGS,
    planner: { createPlan, applyPlan: (plan) => applyPlan(plan, path.join(dir, ".journals")) },
  });
  await fs.writeFile(path.join(dir, "in/Arrival.2016.720p.mkv"), "another copy");
  await offline.addFiles(await scanPaths([path.join(dir, "in")]));
  assert.match(offline.state().groups[0]!.reason, /Add a TMDB token/);
});

test("an imported show folder is renamed, and files left in the queue follow it", async (t) => {
  const { dir } = await setup(t, [
    "Severance/Severance.S01E01.1080p.mkv",
    "Severance/Severance.S01E09.1080p.mkv",
  ]);
  const providers = new Providers({ fetcher: tmdb });
  providers.setToken("test");
  const session = new Session({
    providers,
    settings: DEFAULT_SETTINGS,
    planner: { createPlan, applyPlan: (plan) => applyPlan(plan, path.join(dir, ".journals")) },
  });
  await session.addFiles(await scanPaths([path.join(dir, "Severance")]));
  assert.equal(session.state().destination, path.join(dir, "Severance"));
  session.confirmSuggested();
  const preview = await session.preview();
  // The folder is shown under its new name, beside its old one, not inside it.
  assert.equal(preview.destination, dir);
  assert.deepEqual(preview.renamedFolders, [{ from: "Severance", to: "Severance (2022)" }]);
  assert.deepEqual(preview.newFolders, ["Severance (2022)/Season 01"]);
  assert.deepEqual(
    preview.groups[0]!.items.map((item) => [item.from, item.to]),
    [["Severance.S01E01.1080p.mkv", "Severance (2022)/Season 01/Severance (2022) - S01E01 - Part 1.mkv"]],
  );
  assert.equal(preview.counts.renamed, 1);
  await session.apply(preview.id);
  await fs.access(path.join(dir, "Severance (2022)/Season 01/Severance (2022) - S01E01 - Part 1.mkv"));
  // The episode that was not matched is still queued, under the folder's new name.
  const state = session.state();
  assert.equal(state.destination, path.join(dir, "Severance (2022)"));
  assert.deepEqual(state.groups[0]!.files.map((file) => file.source), ["Severance.S01E09.1080p.mkv"]);
  await fs.access(path.join(state.destination, "Severance.S01E09.1080p.mkv"));
  // Undoing the batch elsewhere gives the folder its old name back, and the queue follows.
  session.relocate([{ from: path.join(dir, "Severance (2022)"), to: path.join(dir, "Severance") }]);
  assert.equal(session.state().destination, path.join(dir, "Severance"));
});

test("settings reject unusable templates and ignore junk", () => {
  assert.deepEqual(mergeSettings({ nfo: "yes", language: "english", preset: "nope" }), DEFAULT_SETTINGS);
  assert.equal(mergeSettings({ preset: "jellyfin" }).templates.movie.includes("[{idsource}id-{id}]"), true);
  const custom = mergeSettings({ preset: "custom", templates: { movie: "{title}", episode: "{title} {season}x{episode}" } });
  assert.equal(custom.templates.movie, "{title}");
  assert.throws(
    () => mergeSettings({ preset: "custom", templates: { movie: "{nope}", episode: "{title}" } }),
    /Films: Unknown placeholder \{nope\}.*TV episodes: The filename must include \{season\}/,
  );
});

test("a wrongly read season or episode can be corrected per file", async (t) => {
  const { session, group } = await setup(t, ["Severance.S01.mkv", "Severance.S01E09.mkv"]);
  const [unnumbered, missing] = group("Severance").files;
  assert.match(missing!.issue!, /episode 9 was not found/);
  assert.match(unnumbered!.issue!, /No episode number/);
  assert.deepEqual(unnumbered!.numbers, { season: 1, episode: null, episodeEnd: null });

  await session.setEpisode(missing!.id, { season: 1, episode: 2, episodeEnd: 3 });
  await session.setEpisode(unnumbered!.id, { season: null, episode: 1, episodeEnd: null });
  assert.deepEqual(
    group("Severance").files.map((file) => [file.label, file.issue, file.target?.split(" - ").slice(1).join(" - ")]),
    [
      ["#1 → S01E01", null, "S01E01 - Part 1.mkv"],
      ["S01E02-E03", null, "S01E02-E03 - Part 2 & Part 3.mkv"],
    ],
  );
  assert.equal(group("Severance").status, "suggested");

  for (const bad of [
    { season: 1, episode: 0, episodeEnd: null },
    { season: -1, episode: 1, episodeEnd: null },
    { season: 1, episode: 2, episodeEnd: 2 },
    { season: 1, episode: 1.5, episodeEnd: null },
  ])
    await assert.rejects(session.setEpisode(missing!.id, bad), /Enter|last episode/);
  await assert.rejects(session.setEpisode("nope", { season: 1, episode: 1, episodeEnd: null }), /no longer/);
});

test("groups can be split and merged by moving files", async (t) => {
  const { session, group } = await setup(t, [
    "Solaris.mkv",
    "Solaris.Directors.Cut.mkv",
    "Severance.S01E01.mkv",
    "Severence.S01E02.mkv",
  ]);
  // A misspelt filename formed its own group; merge it into the right show.
  const typo = group("Severence");
  assert.equal(typo.status, "unmatched");
  const severance = group("Severance");
  session.confirm(severance.key);
  assert.equal(await session.moveFiles([typo.files[0]!.id], severance.key), severance.key);
  assert.equal(session.state().groups.some((g) => g.parsedTitle === "Severence"), false);
  assert.deepEqual(
    group("Severance").files.map((file) => [file.label, !!file.target]),
    [["S01E01", true], ["S01E02", true]],
  );
  assert.equal(group("Severance").status, "confirmed");

  // Split: one file leaves for a group of its own, which is looked up like a new import.
  const solaris = group("Solaris");
  assert.equal(solaris.files.length, 1);
  const cut = group("Solaris Directors Cut");
  const merged = await session.moveFiles([cut.files[0]!.id], solaris.key);
  assert.equal(group("Solaris").files.length, 2);
  await session.choose(merged, 0);
  const split = await session.moveFiles([group("Solaris").files[1]!.id], null);
  assert.notEqual(split, merged);
  assert.equal(group("Solaris").files.length, 1);
  assert.equal(group("Solaris").status, "confirmed");
  const fresh = session.state().groups.find((g) => g.key === split)!;
  assert.deepEqual([fresh.files.length, fresh.status, fresh.kind], [1, "unmatched", "movie"]);

  // Moving a film into a show treats it as an episode that still needs a number.
  await session.moveFiles([fresh.files[0]!.id], group("Severance").key);
  assert.match(group("Severance").files[2]!.issue!, /No episode number/);
  assert.match(group("Severance").reason, /1 file could not be matched/);

  await assert.rejects(session.moveFiles([], null), /at least one file/);
  await assert.rejects(session.moveFiles(["nope"], null), /no longer in the queue/);
  await assert.rejects(session.moveFiles([group("Solaris").files[0]!.id], "missing"), /no longer in the queue/);
});

test("lookups report progress and can be cancelled", async (t) => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "organtic-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const titles = ["Arrival.2016", "Solaris", "Severance.S01E01", "Unknown.One", "Unknown.Two"];
  for (const title of titles) await fs.writeFile(path.join(dir, `${title}.mkv`), title);

  // Requests wait at a gate so the queue can be inspected, and cancelled, mid-flight.
  let open = () => {};
  let gate = new Promise<void>((resolve) => (open = resolve));
  const aborted: boolean[] = [];
  const states: QueueState[] = [];
  const make = () => {
    const providers = new Providers({
      fetcher: async (url, init) => {
        await gate;
        aborted.push(!!init.signal?.aborted);
        if (init.signal?.aborted) throw new Error("aborted");
        return tmdb(url);
      },
    });
    providers.setToken("test");
    return new Session({
      providers,
      settings: DEFAULT_SETTINGS,
      planner: { createPlan, applyPlan: (plan) => applyPlan(plan, path.join(dir, ".journals")) },
      onChange: (state) => states.push(state),
    });
  };
  let session = make();
  const statuses = () => session.state().groups.map((g) => g.status);

  // First run: let everything finish and watch the counter climb.
  const first = session.addFiles(await scanPaths([dir]));
  assert.deepEqual(session.state().lookups, { done: 0, total: 5 });
  assert.deepEqual(statuses(), Array(5).fill("matching"));
  open();
  await first;
  assert.equal(session.state().lookups, null);
  const seen = states.flatMap((state) => (state.lookups ? [state.lookups.done] : []));
  assert.deepEqual([...new Set(seen)], [0, 1, 2, 3, 4]);
  assert.ok(!statuses().includes("matching"));

  // Second run, with nothing cached: cancel while three requests are held and two are queued.
  session = make();
  gate = new Promise<void>((resolve) => (open = resolve));
  aborted.length = 0;
  const second = session.addFiles(await scanPaths([dir]));
  assert.deepEqual(session.state().lookups, { done: 0, total: 5 });
  session.cancelLookups();
  assert.equal(session.state().lookups, null);
  assert.deepEqual(statuses(), Array(5).fill("unmatched"));
  assert.match(session.state().groups[0]!.reason, /Lookup cancelled/);
  const before = states.length;
  open();
  await second;
  // The held requests were aborted, and nothing they returned reached the queue.
  assert.ok(aborted.length >= 3 && aborted.every(Boolean));
  assert.equal(states.length, before);
  assert.deepEqual(statuses(), Array(5).fill("unmatched"));
  session.cancelLookups();

  assert.ok(session.state().groups.every((g) => g.chosen === null && /find a match/.test(g.reason)));

  // A cancelled group can still be searched by hand.
  const solaris = session.state().groups.find((g) => g.parsedTitle === "Solaris")!;
  await session.search(solaris.key, { query: "Solaris", kind: "movie" });
  assert.equal(session.state().groups.find((g) => g.key === solaris.key)!.candidates.length, 2);

  // A matched group that was only being refreshed keeps its match and status when cancelled.
  await session.search(session.state().groups.find((g) => g.parsedTitle === "Arrival")!.key, {
    query: "Arrival",
    kind: "movie",
  });
  const arrival = () => session.state().groups.find((g) => g.parsedTitle === "Arrival")!;
  session.confirm(arrival().key);
  await fs.mkdir(path.join(dir, "more"));
  await fs.writeFile(path.join(dir, "more/Arrival.2016.1080p.mkv"), "second copy");
  gate = new Promise<void>((resolve) => (open = resolve));
  const third = session.addFiles(await scanPaths([path.join(dir, "more")]));
  assert.equal(arrival().status, "matching");
  session.cancelLookups();
  open();
  await third;
  assert.deepEqual([arrival().status, arrival().chosen, arrival().files.length], ["confirmed", 0, 2]);
  assert.match(arrival().reason, /Search to refresh/);
});

test("a group can read its files in an alternate order", async (t) => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "organtic-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const name of ["Severance.S01E01.mkv", "Severance.S01E02.mkv"]) await fs.writeFile(path.join(dir, name), name);
  const providers = new Providers({
    fetcher: async (url) =>
      url.pathname.endsWith("/episode_groups")
        ? Response.json({ results: [{ id: "0000beef0001", name: "Disc set", type: 3 }] })
        : url.pathname.includes("/episode_group/")
          ? Response.json({
              groups: [{ order: 1, episodes: [
                { id: 3, name: "Part 3", season_number: 1, episode_number: 3, order: 0 },
                { id: 1, name: "Part 1", season_number: 1, episode_number: 1, order: 1 },
              ] }],
            })
          : tmdb(url),
  });
  providers.setToken("test");
  const session = new Session({
    providers,
    settings: DEFAULT_SETTINGS,
    planner: { createPlan, applyPlan: (plan) => applyPlan(plan, path.join(dir, ".journals")) },
  });
  await session.addFiles(await scanPaths([dir]));
  const group = () => session.state().groups[0]!;
  const names = () => group().files.map((file) => file.target?.split(" - ").slice(1).join(" - "));
  assert.deepEqual(group().orderings, [{ id: "0000beef0001", name: "Disc set · DVD" }]);
  assert.deepEqual([group().ordering, group().keepNumbers], [null, false]);
  assert.deepEqual(names(), ["S01E01 - Part 1.mkv", "S01E02 - Part 2.mkv"]);

  // Read as disc order and converted: the first file is really aired episode 3.
  await session.setOrdering(group().key, "0000beef0001", false);
  assert.deepEqual(names(), ["S01E03 - Part 3.mkv", "S01E01 - Part 1.mkv"]);
  assert.match(group().reason, /read in Disc set · DVD and converted to aired order/);
  // Kept: the disc numbers stay, with the titles of the episodes actually in those slots.
  await session.setOrdering(group().key, "0000beef0001", true);
  assert.deepEqual(names(), ["S01E01 - Part 3.mkv", "S01E02 - Part 1.mkv"]);
  await session.setOrdering(group().key, null, true);
  assert.deepEqual([group().ordering, group().keepNumbers], [null, false]);
  assert.deepEqual(names(), ["S01E01 - Part 1.mkv", "S01E02 - Part 2.mkv"]);

  await assert.rejects(session.setOrdering(group().key, "ffffffff", false), /not available/);
  // Choosing a show again starts from aired order.
  await session.setOrdering(group().key, "0000beef0001", false);
  await session.search(group().key, { query: "Severance", kind: "tv" });
  assert.equal(group().ordering, null);
});

test("files named by air date are matched to their episode and can be overridden", async (t) => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "organtic-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const name of ["Daily.2024.03.15.1080p.mkv", "Daily.2024.03.20.1080p.mkv"]) await fs.writeFile(path.join(dir, name), name);
  const providers = new Providers({
    fetcher: async (url) => {
      const other = elsewhere(url);
      if (other) return other;
      const at = url.pathname.replace("/3/", "");
      if (at === "search/tv") return Response.json({ results: [{ id: 7, name: "Daily", first_air_date: "1996-07-22" }] });
      if (at === "tv/7") return Response.json({ seasons: [{ season_number: 29, air_date: "2023-10-16", episode_count: 2 }] });
      if (at === "tv/7/season/29")
        return Response.json({ episodes: [
          { id: 1, episode_number: 66, name: "Friday's Guest", air_date: "2024-03-15" },
          { id: 2, episode_number: 67, name: "Monday's Guest", air_date: "2024-03-18" },
        ] });
      return new Response("", { status: 404 });
    },
  });
  providers.setToken("test");
  const session = new Session({
    providers,
    settings: mergeSettings({ preset: "custom", templates: { movie: "{title}", episode: "{title} - {airdate} - S{season:00}E{episode:00} - {episodeTitle}" } }),
    planner: { createPlan, applyPlan: (plan) => applyPlan(plan, path.join(dir, ".journals")) },
  });
  await session.addFiles(await scanPaths([dir]));
  const group = () => session.state().groups[0]!;
  assert.equal(group().parsedTitle, "Daily");
  assert.deepEqual(
    group().files.map((file) => [file.label, file.target ?? file.issue]),
    [
      ["2024-03-15 → S29E66", "Daily - 2024-03-15 - S29E66 - Friday's Guest.mkv"],
      ["2024-03-20", "No episode of this show is listed as airing on 2024-03-20."],
    ],
  );
  // The date in the name was off; give the real episode by hand.
  await session.setEpisode(group().files[1]!.id, { season: 29, episode: 67, episodeEnd: null });
  assert.deepEqual(
    [group().files[1]!.label, group().files[1]!.target],
    ["S29E67", "Daily - 2024-03-18 - S29E67 - Monday's Guest.mkv"],
  );
});

test("a fansub release is found under its English title, with Kitsu's own entry offered beside it", async (t) => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "organtic-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const name of ["[SubsPlease] Sousou no Frieren - 02 (1080p) [ABCD1234].mkv", "Sousou.no.Frieren.S01E03.mkv"])
    await fs.writeFile(path.join(dir, name), name);
  const asked: string[] = [];
  const make = (settings: Partial<AppSettings> = {}) => {
    const providers = new Providers({
      fetcher: async (url) => {
        if (url.hostname === "kitsu.io") {
          asked.push(url.searchParams.get("filter[text]") ?? "episodes");
          if (url.pathname.endsWith("/episodes"))
            return Response.json({ data: [2, 3].map((number) => ({ attributes: { number, canonicalTitle: `Kitsu ${number}` } })) });
          return Response.json({
            data: [{ id: "46474", attributes: {
              canonicalTitle: "Sousou no Frieren",
              titles: { en: "Frieren: Beyond Journey's End", en_jp: "Sousou no Frieren" },
              startDate: "2023-09-29", subtype: "TV",
            } }],
          });
        }
        // This catalogue only knows the show by its English title.
        if (url.pathname === "/3/search/tv")
          return Response.json({
            results: url.searchParams.get("query") === "Frieren: Beyond Journey's End"
              ? [{ id: 209867, name: "Frieren: Beyond Journey's End", first_air_date: "2023-09-29" }]
              : [],
          });
        return tmdb(url);
      },
    });
    providers.setToken("test");
    return new Session({
      providers,
      settings: mergeSettings(settings),
      planner: { createPlan, applyPlan: (plan) => applyPlan(plan, path.join(dir, ".journals")) },
    });
  };
  const session = make({ animeSeasons: true });
  await session.addFiles(await scanPaths([dir]));
  const group = () => session.state().groups[0]!;
  assert.equal(group().status, "suggested");
  assert.equal(group().candidates[0]!.title, "Frieren: Beyond Journey's End");
  assert.match(group().reason, /Found under its other title “Frieren: Beyond Journey's End”, which Kitsu lists for “Sousou no Frieren”/);
  assert.deepEqual(group().files.map((file) => file.label), ["#2 → S01E02", "S01E03"]);
  assert.deepEqual(asked, ["Sousou no Frieren", "Frieren: Beyond Journey's End"]);

  // Both sources list it, which is one match and not two to choose between; TMDB leads.
  assert.deepEqual(group().candidates.map((item) => item.provider), ["tmdb", "kitsu"]);
  assert.equal(group().chosen, 0);
  // Chosen instead, Kitsu names the files from its own entry.
  await session.choose(group().key, 1);
  assert.deepEqual(
    group().files.map((file) => file.target),
    [
      "Frieren Beyond Journey's End (2023)/Season 01/Frieren Beyond Journey's End (2023) - S01E02 - Kitsu 2.mkv",
      "Frieren Beyond Journey's End (2023)/Season 01/Frieren Beyond Journey's End (2023) - S01E03 - Kitsu 3.mkv",
    ],
  );

  // The numbering choice is offered for a Kitsu show and kept when another result is chosen.
  assert.deepEqual([group().numberingChoice, group().numbering], [true, "tmdb"]);
  await session.setNumbering(group().key, "tvdb");
  assert.equal(group().numbering, "tvdb");
  // No mapping list here, so there is no TVDB numbering to use and the group says so.
  assert.match(group().reason, /TVDB numbering is not known for this entry/);
  await session.choose(group().key, 0);
  assert.deepEqual([group().numberingChoice, group().numbering], [false, "tvdb"]);

  // Season mapping is off unless asked for, and without it there is no numbering to choose.
  assert.equal(DEFAULT_SETTINGS.animeSeasons, false);
  const unmapped = make();
  await unmapped.addFiles(await scanPaths([dir]));
  await unmapped.choose(unmapped.state().groups[0]!.key, 1);
  assert.equal(unmapped.state().groups[0]!.candidates[1]!.provider, "kitsu");
  assert.equal(unmapped.state().groups[0]!.numberingChoice, false);

  // Turned off, there is no second search: Kitsu's entry is offered, but not trusted.
  asked.length = 0;
  const off = make({ animeTitles: false });
  await off.addFiles(await scanPaths([dir]));
  assert.deepEqual(
    [off.state().groups[0]!.status, off.state().groups[0]!.candidates.map((item) => item.provider)],
    ["review", ["kitsu"]],
  );
  assert.deepEqual(asked, ["Sousou no Frieren", "episodes"]);
});

test("every source is searched, and one that fails is named without hiding the rest", async (t) => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "organtic-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "Severance.S01E01.mkv"), "x");
  let kitsuDown = true;
  let kitsuAsked = 0;
  const providers = new Providers({
    fetcher: async (url) => {
      if (url.hostname === "kitsu.io" && ++kitsuAsked)
        return kitsuDown ? new Response("", { status: 500 }) : Response.json({ data: [] });
      if (url.pathname === "/search/shows")
        return Response.json([
          { show: { id: 44933, name: "Severance", premiered: "2022-02-18" } },
          { show: { id: 5, name: "Severance Pay", premiered: "2006-01-01" } },
        ]);
      return url.hostname === "api.tvmaze.com" ? new Response("", { status: 404 }) : tmdb(url);
    },
  });
  providers.setToken("test");
  const session = new Session({
    providers,
    settings: DEFAULT_SETTINGS,
    planner: { createPlan, applyPlan: (plan) => applyPlan(plan, path.join(dir, ".journals")) },
  });
  await session.addFiles(await scanPaths([dir]));
  const group = () => session.state().groups[0]!;
  // TVmaze's listing of the same show is not a rival, so the match is still suggested.
  assert.deepEqual(
    group().candidates.map((item) => [item.provider, item.year]),
    [["tmdb", 2022], ["tvmaze", 2022], ["tvmaze", 2006]],
  );
  assert.deepEqual([group().status, group().chosen], ["suggested", 0]);
  assert.match(group().files[0]!.target!, /^Severance \(2022\)\//);
  // Nothing about the name says anime, so Kitsu was not asked.
  assert.deepEqual([group().anime, kitsuAsked], [false, 0]);

  // Searched as anime, it stays a show and Kitsu joins the sources.
  await session.search(group().key, { query: "Severance", kind: "anime" });
  assert.deepEqual([group().anime, group().kind, group().status, kitsuAsked], [true, "tv", "suggested", 1]);
  assert.match(group().reason, /Kitsu could not be searched, so its results are missing\./);
  kitsuDown = false;
  await session.search(group().key, { query: "Severance", kind: "tv" });
  assert.deepEqual([group().anime, kitsuAsked], [false, 1]);
  assert.doesNotMatch(group().reason, /could not be searched/);
});

test("files with no usable number are matched by the episode name in the filename", async (t) => {
  const { group } = await setup(t, [
    "Severance/Season 1/Severance - Part 2.mkv",
    "Severance/Season 1/Severance 103.mkv",
    "Severance/Season 1/Severance - Unknown.mkv",
    "Severance - 0101 - Part 1.mkv",
  ]);
  const found = group("Severance");
  assert.deepEqual(
    found.files.map((file) => [file.label, file.issue]).sort(),
    [
      ["S01E01", null],
      ["S01E03", null],
      ["no number", "No episode of this show is named like “unknown”."],
      ["“part 2” → S01E02", null],
    ],
  );
  assert.match(found.reason, /1 file was matched by episode name, having no number\./);
});
