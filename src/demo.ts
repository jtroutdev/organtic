// Browser preview: the real queue logic over example files and a canned catalogue.
// Nothing here reads or renames local files or contacts a metadata source.
import type { MediaApi } from "../core/api.ts";
import { renderTemplate } from "../core/naming.ts";
import { parseMediaPath } from "../core/parse.ts";
import { Providers } from "../core/providers.ts";
import { Session } from "../core/session.ts";
import { nameVersions } from "../core/versions.ts";
import type { Planner } from "../core/session.ts";
import { DEFAULT_SETTINGS, mergeSettings } from "../core/settings.ts";
import type {
  BatchSummary,
  MediaFile,
  Operation,
  Plan,
  QueueState,
  Selection,
  SourcesState,
} from "../core/types.ts";

const ROOT = "/Example media";
const severance = "Severance.S01.1080p.WEB-DL-GRP/Severance.S01E0";
const EXAMPLE_FILES = [
  `${severance}1.1080p.WEB-DL-GRP.mkv`,
  "Severance.S01.1080p.WEB-DL-GRP/Severance.S01E02E03.1080p.WEB-DL-GRP.mkv",
  `${severance}4.1080p.WEB-DL-GRP.mkv`,
  `${severance}5.1080p.WEB-DL-GRP.mkv`,
  ...[1, 2, 3, 4].map(
    (n) => `[SubsPlease] Sousou no Frieren - 0${n} (1080p) [A${n}F3B2C9].mkv`,
  ),
  "The Bear/Season 2/06 - fishes.mkv",
  "The Bear/Season 2/07 - forks.mkv",
  "The Bear/Season 2/11.mkv",
  "Arrival.2016.1080p.BluRay.x264-GRP/grp-arrival.mkv",
  "Arrival.2016.1080p.BluRay.x264-GRP/Sample/arrival-sample.mkv",
  "Arrival.2016.1080p.BluRay.x264-GRP/Featurettes/Making Of.mkv",
  "Dune.2021.2160p.WEB-DL.mkv",
  "Dune.2021.1080p.BluRay.mkv",
  "Solaris.mkv",
];

const SHOWS = [
  {
    id: 95396,
    name: "Severance",
    first_air_date: "2022-02-17",
    words: ["severance"],
    overview:
      "Mark leads a team of office workers whose memories have been surgically divided.",
    seasons: {
      1: ["Good News About Hell", "Half Loop", "In Perpetuity", "The You You Are", "The Grim Barbarity of Optics and Design", "Hide and Seek", "Defiant Jazz", "What's for Dinner?", "The We We Are"],
    },
  },
  {
    id: 209867,
    name: "Frieren: Beyond Journey's End",
    first_air_date: "2023-09-29",
    words: ["frieren"],
    overview:
      "An elf mage outlives her adventuring party and sets out to understand the people she travelled with.",
    seasons: {
      1: ["The Journey's End", "It Didn't Have to Be Magic...", "Killing Magic", "The Land Where Souls Rest", "Phantoms of the Dead", "The Hero of the Village"],
    },
  },
  {
    id: 136315,
    name: "The Bear",
    first_air_date: "2022-06-23",
    words: ["bear"],
    overview:
      "A fine-dining chef returns to Chicago to run his family's sandwich shop.",
    seasons: {
      1: ["System", "Hands", "Brigade", "Dogs", "Sheridan", "Ceres", "Review", "Braciole"],
      2: ["Beef", "Pasta", "Sundae", "Honeydew", "Pop", "Fishes", "Forks", "Bolognese", "Omelette", "The Bear"],
    },
  },
] as const;
const FILMS = [
  { id: 329865, title: "Arrival", release_date: "2016-11-10", overview: "A linguist is recruited to communicate with visitors whose ships have appeared around the world." },
  { id: 10547, title: "The Arrival", release_date: "1996-05-31", overview: "A radio astronomer intercepts a signal and uncovers a conspiracy." },
  { id: 438631, title: "Dune", release_date: "2021-09-15", overview: "Paul Atreides travels to the desert planet Arrakis." },
  { id: 841, title: "Dune", release_date: "1984-12-14", overview: "David Lynch's adaptation of the Frank Herbert novel." },
  { id: 593, title: "Solaris", release_date: "1972-03-20", overview: "Andrei Tarkovsky. A psychologist is sent to a station orbiting a sentient ocean planet." },
  { id: 2103, title: "Solaris", release_date: "2002-11-27", overview: "Steven Soderbergh. A psychologist investigates a crew's strange behaviour above Solaris." },
];

async function catalogue(url: URL): Promise<Response> {
  // A real source takes a moment; without this, progress and cancelling never show.
  await new Promise((resolve) => setTimeout(resolve, 350));
  // Only TMDB is canned; the other sources have nothing to add.
  if (url.hostname !== "api.themoviedb.org")
    return Response.json(url.hostname === "kitsu.io" ? { data: [] } : []);
  const at = url.pathname.replace("/3/", "");
  const query = (url.searchParams.get("query") ?? "").toLowerCase();
  const year = url.searchParams.get("year");
  if (at === "search/tv")
    return Response.json({
      results: SHOWS.filter((show) =>
        show.words.some((word) => query.includes(word)),
      ),
    });
  if (at === "search/movie")
    return Response.json({
      results: FILMS.filter(
        (film) =>
          film.title.toLowerCase().includes(query) &&
          (!year || film.release_date.startsWith(year)),
      ),
    });
  // One example ordering: The Bear's second season as if a disc set had shuffled it.
  if (at === "tv/136315/episode_groups")
    return Response.json({
      results: [{ id: "0000beef0001", name: "Disc set", type: 3 }],
    });
  if (at === "tv/episode_group/0000beef0001") {
    const titles = SHOWS[2].seasons[2];
    const disc = [6, 7, 1, 2, 3, 4, 5, 8, 9, 10];
    return Response.json({
      groups: [
        {
          order: 2,
          episodes: disc.map((number, order) => ({
            id: 136315200 + number,
            name: titles[number - 1],
            season_number: 2,
            episode_number: number,
            order,
          })),
        },
      ],
    });
  }
  const [, id, season] = /^tv\/(\d+)(?:\/season\/(\d+))?$/.exec(at) ?? [];
  const show = SHOWS.find((item) => String(item.id) === id);
  const seasons: Record<string, readonly string[]> = show?.seasons ?? {};
  if (show && !season)
    return Response.json({
      seasons: Object.entries(seasons).map(([number, titles]) => ({
        season_number: Number(number),
        episode_count: titles.length,
      })),
    });
  const titles = season ? seasons[season] : undefined;
  if (!titles) return new Response("", { status: 404 });
  return Response.json({
    episodes: titles.map((name, index) => ({
      id: Number(id) * 1000 + Number(season) * 100 + index,
      episode_number: index + 1,
      name,
    })),
  });
}

function exampleFiles(): MediaFile[] {
  return EXAMPLE_FILES.map((relative, index) => {
    const path = `${ROOT}/${relative}`;
    return {
      id: `example-${index}`,
      path,
      root: ROOT,
      name: relative.split("/").at(-1)!,
      size: 2 ** 30,
      parsed: parseMediaPath(path, ROOT),
    };
  });
}

/** Plans without a filesystem: every templated folder counts as new, and nothing is moved. */
const planner: Planner = {
  async createPlan(selections, options) {
    const folders = new Map<string, Operation>();
    const operations: Operation[] = [];
    const previews: Plan["previews"] = [];
    const templates = options.templates ?? DEFAULT_SETTINGS.templates;
    const render = ({ media }: Selection) =>
      renderTemplate(media.kind === "tv" ? templates.episode : templates.movie, media);
    const versions = nameVersions(selections, (selection) =>
      options.organize === false
        ? `${selection.file.path.slice(0, selection.file.path.lastIndexOf("/"))}/${render(selection).pop()}`
        : [selection.file.root, ...render(selection)].join("/"),
    );
    for (const selection of selections) {
      const { file, media } = selection;
      const version = versions.get(selection);
      const segments = render(selection);
      const stem = segments.pop()! + (version ? ` - ${version.label}` : "");
      let folder = file.path.slice(0, file.path.lastIndexOf("/"));
      if (options.organize !== false) {
        folder = file.root;
        for (const segment of segments) {
          folder += `/${segment}`;
          folders.set(folder, { type: "mkdir", target: folder });
        }
      }
      const target = `${folder}/${stem}.mkv`;
      const changes: Plan["previews"][number]["changes"] = [
        { source: file.path, target, note: version?.note },
      ];
      operations.push({
        type: "move",
        source: file.path,
        target,
        fingerprint: { dev: 0, ino: 0, size: file.size, mtimeMs: 0 },
      });
      if (options.nfo && !version) {
        const nfo = `${folder}/${stem}.nfo`;
        operations.push({ type: "write", target: nfo, content: "" });
        changes.push({ source: null, target: nfo });
      }
      previews.push({ source: file.path, target, title: media.title, changes });
    }
    const seen = new Set<string>();
    const issues: Plan["issues"] = [];
    for (const op of operations) {
      if (seen.has(op.target.toLowerCase()))
        issues.push({
          target: op.target,
          message: "Two operations have the same destination.",
        });
      seen.add(op.target.toLowerCase());
    }
    return {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      previews,
      sourceChecks: [],
      operations: [...folders.values(), ...operations],
      errors: issues.map((issue) => issue.message),
      issues,
    };
  },
  async applyPlan(plan) {
    batches.unshift({
      id: plan.id,
      createdAt: plan.createdAt,
      count: plan.operations.length,
      status: "complete",
      operations: plan.operations.map((op) => ({
        type: op.type,
        source: op.type === "move" || op.type === "rename" ? op.source : undefined,
        target: op.target,
      })),
    });
    return { id: plan.id, completed: plan.operations.length };
  },
};

const batches: BatchSummary[] = [];
const listeners: ((queue: QueueState) => void)[] = [];
const providers = new Providers({ fetcher: catalogue });
providers.setToken("example");
let settings = DEFAULT_SETTINGS;
let sources: SourcesState = { tmdb: "session", tvdb: "none", canSave: false };
const session = new Session({
  providers,
  planner,
  settings,
  onChange: (queue) => listeners.forEach((listener) => listener(queue)),
});
const addExamples = () => session.addFiles({ files: exampleFiles(), skipped: [] });

export const demoApi: MediaApi = {
  desktop: false,
  async load() {
    void addExamples();
    return { queue: session.state(), settings, sources };
  },
  onQueue: (listener) => void listeners.push(listener),
  addFiles: addExamples,
  addFolder: addExamples,
  addDropped: addExamples,
  search: (key, request) => session.search(key, request),
  choose: (key, index) => session.choose(key, index),
  confirm: async (key) => session.confirm(key),
  confirmSuggested: async () => session.confirmSuggested(),
  cancelLookups: async () => session.cancelLookups(),
  remove: async (key) => session.remove(key),
  clear: async () => session.clear(),
  include: (fileId) => session.include(fileId),
  exclude: async (fileId, excluded) => session.exclude(fileId, excluded),
  setEpisode: (fileId, numbers) => session.setEpisode(fileId, numbers),
  setNumbering: (key, numbering) => session.setNumbering(key, numbering),
  setOrdering: (key, id, keepNumbers) => session.setOrdering(key, id, keepNumbers),
  moveFiles: (fileIds, targetKey) => session.moveFiles(fileIds, targetKey),
  chooseDestination: async () => session.setDestination(`${ROOT}/Library`),
  resetDestination: async () => session.setDestination(null),
  preview: () => session.preview(),
  apply: (planId) => session.apply(planId),
  history: async () => structuredClone(batches),
  async undo(batchId) {
    const batch = batches.find((item) => item.id === batchId);
    if (batch) batch.status = "undone";
    return {};
  },
  async saveSettings(input) {
    settings = mergeSettings(input, settings);
    session.updateSettings(settings);
    return settings;
  },
  async setToken(token) {
    sources = { ...sources, tmdb: token.trim() ? "session" : "none" };
    return sources;
  },
  async setTvdbKey(key) {
    sources = { ...sources, tvdb: key.trim() ? "session" : "none" };
    return sources;
  },
  async openReference() {},
};
