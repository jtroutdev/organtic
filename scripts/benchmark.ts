/**
 * Times the app's own work on a generated library: import and lookups, preview, apply, history
 * and undo, with the network stood in for so only the app is measured. Builds the library in a
 * temporary folder and removes it afterwards; never touches anything else.
 *
 *   npm run bench                       the three standard libraries
 *   npm run bench -- --only large       one of them: small, large, flat
 *   npm run bench -- --files 20000 --shows 1600 [--flat]
 *   npm run bench -- --dir /some/disk   where the temporary folder goes (default: the OS temp
 *                                       folder, which is often in memory; use a real disk to
 *                                       compare with the budget)
 *
 * "Main process blocked" is the longest the main process's event loop was held up, in any
 * phase; the window's own work on each push is not measured here.
 *
 * The budget and the recorded results are in docs/VALIDATION.md.
 */
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { applyPlan, checkRoom, createPlan, history, scanPaths, undoBatch } from "../core/files.ts";
import { Providers } from "../core/providers.ts";
import { Session } from "../core/session.ts";
import { DEFAULT_SETTINGS } from "../core/settings.ts";

type Library = { name: string; files: number; shows: number; flat: boolean };

const STANDARD: Library[] = [
  { name: "small", files: 500, shows: 50, flat: false },
  { name: "large", files: 4800, shows: 400, flat: false },
  { name: "flat", files: 3000, shows: 300, flat: true },
];

const WORDS = [
  "Amber", "Birch", "Cobalt", "Dune", "Ember", "Fable", "Garnet", "Harbor", "Ivory", "Juniper",
  "Kestrel", "Lantern", "Meadow", "Nimbus", "Orchid", "Pebble", "Quarry", "Raven", "Saffron", "Thistle",
  "Umber", "Velvet", "Willow", "Xenon", "Yarrow", "Zephyr", "Alder", "Bramble", "Cinder", "Drift",
  "Echo", "Fennel", "Glacier", "Hollow", "Indigo", "Jasper", "Kelp", "Lumen", "Marble", "Nettle",
];

/** Show titles from pairs of words: plain, distinct, and free of numbers a parser could misread. */
function titles(count: number) {
  const result: string[] = [];
  for (const first of WORDS)
    for (const second of WORDS)
      if (first !== second && result.length < count) result.push(`${first} ${second}`);
  if (result.length < count) throw new Error(`At most ${result.length} shows.`);
  return result;
}

/** Episodes per show, spread as evenly as the counts allow. */
function episodes(library: Library) {
  const base = Math.floor(library.files / library.shows);
  const extra = library.files % library.shows;
  return titles(library.shows).map((title, index) => ({
    title,
    id: 10_000 + index,
    count: base + (index < extra ? 1 : 0),
  }));
}

async function build(root: string, library: Library) {
  const shows = episodes(library);
  for (const show of shows) {
    const folder = library.flat ? root : path.join(root, show.title, "Season 01");
    await fs.mkdir(folder, { recursive: true });
    for (let episode = 1; episode <= show.count; episode++) {
      const name = `${show.title.replace(" ", ".")}.S01E${String(episode).padStart(2, "0")}.1080p.WEB.mkv`;
      await fs.writeFile(path.join(folder, name), `${show.title} ${episode}`);
    }
  }
  return shows;
}

/** TMDB answering at once from the generated shows; the other sources answer with nothing. */
function catalogue(shows: ReturnType<typeof episodes>) {
  const byTitle = new Map(shows.map((show) => [show.title.toLowerCase(), show]));
  const byId = new Map(shows.map((show) => [String(show.id), show]));
  const unknown = new Map<string, number>();
  const fetcher = async (url: URL) => {
    if (url.hostname !== "api.themoviedb.org")
      return Response.json(url.hostname === "kitsu.io" ? { data: [] } : []);
    const at = url.pathname.replace("/3/", "");
    if (at === "search/tv") {
      const show = byTitle.get((url.searchParams.get("query") ?? "").toLowerCase());
      return Response.json({
        results: show ? [{ id: show.id, name: show.title, first_air_date: "2020-01-01" }] : [],
      });
    }
    if (at === "search/movie" || /^tv\/\d+\/episode_groups$/.test(at))
      return Response.json({ results: [] });
    const series = /^tv\/(\d+)$/.exec(at);
    if (series && byId.has(series[1]!))
      return Response.json({ seasons: [{ season_number: 1, episode_count: byId.get(series[1]!)!.count }] });
    const season = /^tv\/(\d+)\/season\/1$/.exec(at);
    if (season && byId.has(season[1]!))
      return Response.json({
        episodes: Array.from({ length: byId.get(season[1]!)!.count }, (_, index) => ({
          id: index + 1,
          episode_number: index + 1,
          name: `Chapter ${index + 1}`,
        })),
      });
    const shape = at.replace(/\d+/g, "N");
    unknown.set(shape, (unknown.get(shape) ?? 0) + 1);
    return new Response("", { status: 404 });
  };
  return { fetcher, unknown };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const megabytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;

async function run(library: Library, base: string) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(base, "organtic-bench-")));
  try {
    const media = path.join(root, "media");
    const journalDir = path.join(root, "history");
    const shows = await build(media, library);
    const { fetcher, unknown } = catalogue(shows);
    const providers = new Providers({ fetcher });
    providers.setToken("benchmark");

    // Each push is serialised as the desktop app does when it sends the queue to the window.
    let pushes = 0;
    let bytes = 0;
    const session = new Session({
      providers,
      settings: DEFAULT_SETTINGS,
      planner: {
        // As the desktop app plans: the plan, then the room check.
        createPlan: async (selections, options) => {
          const plan = await createPlan(selections, options);
          if (plan.operations.length)
            for (const message of await checkRoom(plan, journalDir)) plan.errors.push(message);
          return plan;
        },
        applyPlan: (plan, signal) => applyPlan(plan, journalDir, undefined, signal),
      },
      onChange: (queue) => {
        pushes++;
        bytes += JSON.stringify(queue).length;
      },
    });

    const delay = monitorEventLoopDelay({ resolution: 10 });
    const phase = async <T>(work: () => Promise<T>) => {
      delay.reset();
      delay.enable();
      const start = performance.now();
      const value = await work();
      const elapsed = performance.now() - start;
      delay.disable();
      return { value, elapsed, blocked: delay.max / 1e6 };
    };

    const imported = await phase(async () => session.addFiles(await scanPaths([media])));
    const queue = session.state();
    const suggested = queue.groups.filter((group) => group.status === "suggested").length;
    const lookupPushes = pushes;
    const lookupBytes = bytes;
    session.confirmSuggested();
    const preview = await phase(() => session.preview());
    if (preview.value.errors?.length)
      throw new Error(`Preview found problems: ${preview.value.errors.slice(0, 3).join(" ")}`);
    const applied = await phase(() => session.apply(preview.value.id));
    const listed = await phase(() => history(journalDir));
    const batch = listed.value[0];
    if (!batch) throw new Error("The batch is not in History.");
    const undone = await phase(() => undoBatch(batch.id, journalDir));

    return {
      library,
      groups: queue.groups.length,
      suggested,
      pushes: lookupPushes,
      bytes: lookupBytes,
      phases: { imported, preview, applied, listed, undone },
      unknown,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    files: { type: "string" },
    shows: { type: "string" },
    flat: { type: "boolean", default: false },
    dir: { type: "string", default: os.tmpdir() },
  },
});
const libraries = values.files
  ? [{
      name: "custom",
      files: Number(values.files),
      shows: Number(values.shows ?? Math.max(1, Math.round(Number(values.files) / 12))),
      flat: values.flat,
    }]
  : STANDARD.filter((library) => !values.only || library.name === values.only);
if (!libraries.length) throw new Error(`No library called "${values.only}".`);

console.log(`Organtic benchmark, Node ${process.version}, ${os.platform()} ${os.arch()}, in ${values.dir}\n`);
console.log("| Library | Groups | Pushes | Serialised | Import and lookups | Preview | Apply | History | Undo | Main process blocked |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const library of libraries) {
  const result = await run(library, values.dir);
  const { imported, preview, applied, listed, undone } = result.phases;
  const blocked = Math.max(...Object.values(result.phases).map((phase) => phase.blocked));
  console.log(
    `| ${library.files.toLocaleString("en")} files, ${library.shows} shows${library.flat ? ", one folder" : ""} | ${result.groups} | ${result.pushes} | ${megabytes(result.bytes)} | ${seconds(imported.elapsed)} | ${seconds(preview.elapsed)} | ${seconds(applied.elapsed)} | ${seconds(listed.elapsed)} | ${seconds(undone.elapsed)} | ${Math.round(blocked)} ms |`,
  );
  if (result.suggested !== library.shows)
    console.warn(`  ${result.suggested} of ${library.shows} shows were suggested; the stand-in catalogue needs a look.`);
  for (const [shape, count] of result.unknown)
    console.warn(`  Unanswered request: ${shape} (${count})`);
}
