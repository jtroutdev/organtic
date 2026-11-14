import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS, makeNfo } from "./media.ts";
import { normalizeTitle, parseMediaPath, parseStem } from "./parse.ts";
import { nameVersions } from "./versions.ts";
import { PLEX_TEMPLATES, renderTemplate, safeName } from "./naming.ts";
import type {
  BatchSummary,
  Fingerprint,
  JournalEvent,
  MediaFile,
  MediaLike,
  MkdirOperation,
  MoveOperation,
  Operation,
  RenameOperation,
  RmdirOperation,
  Plan,
  PlanOptions,
  ScanResult,
  Selection,
} from "./types.ts";

/** Calls that tests replace: the filesystem ones to simulate volumes without hard links, `fetch` for artwork. */
export type FileOps = Pick<typeof fs, "link" | "rename"> & {
  fetch?: typeof fetch;
};

const ARTWORK_HOSTS = [
  "image.tmdb.org",
  "static.tvmaze.com",
  "media.kitsu.app",
  "media.kitsu.io",
];
const ARTWORK_LIMIT = 20 * 1024 * 1024;
const IMAGE = /\.(jpe?g|png|webp)$/i;
// Names Plex, Jellyfin and Kodi already treat as a title's poster or backdrop.
const ARTWORK = [
  { stem: "poster", from: "posterUrl", taken: ["poster", "folder", "cover", "default"] },
  { stem: "fanart", from: "backdropUrl", taken: ["fanart", "background", "backdrop", "art"] },
] as const;

// Files that describe the video they are named after, beyond subtitles.
const SIDECAR_EXTENSIONS = ["nfo", "jpg", "jpeg", "png", "webp", "tbn"];
// Files that describe the folder they are in: a film's folder, or one season's.
const SEASON_ASSET =
  /^season(-?\d{1,3}|-specials|-all)?(-(poster|fanart|banner|landscape|thumb))?\.(jpe?g|png|webp|tbn)$|^season\.nfo$/i;
const FOLDER_ASSET = new RegExp(
  `^(poster|fanart|folder|cover|default|background|backdrop|art|banner|logo|clearlogo|clearart|landscape|thumb|disc|discart)\\.(jpe?g|png|webp|tbn)$|^movie\\.nfo$|${SEASON_ASSET.source}`,
  "i",
);
// Files that describe a whole show and live in its top folder.
const SHOW_ASSET =
  /^(poster|fanart|folder|cover|default|background|backdrop|art|banner|logo|clearlogo|clearart|landscape|thumb|characterart)\.(jpe?g|png|webp|tbn)$|^tvshow\.nfo$/i;
const SEASON_FOLDER =
  /^(?:(?:season|series|staffel|saison)[ ._-]?\d{1,3}|S\d{1,2}|specials?)$/i;

/** Every video under a folder, however deep; null if the folder is too large to judge. */
async function videosUnder(dir: string): Promise<string[] | null> {
  const found: string[] = [];
  const pending = [dir];
  let seen = 0;
  for (let current = pending.pop(); current; current = pending.pop()) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (++seen > 5000) return null;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (isVideo(entry.name)) found.push(full);
    }
  }
  return found;
}

const stemOf = (name: string) => name.slice(0, name.length - path.extname(name).length);
const isVideo = (name: string) =>
  VIDEO_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase());

/** Artwork is fetched only over HTTPS from the providers' own image hosts. */
export function isArtworkUrl(value: unknown): value is string {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && ARTWORK_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

const key = (name: string) => name.normalize("NFC").toLowerCase();
const codeOf = (error: unknown) =>
  error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
// What the system's own error codes mean to someone looking at their files.
const PLAIN: Record<string, string> = {
  ENOSPC: "The disk is full",
  EDQUOT: "The disk quota is used up",
  EROFS: "The disk is read-only",
  EACCES: "Permission was denied",
  EPERM: "The system did not allow it",
  EBUSY: "It is in use by another program",
  ETXTBSY: "It is in use by another program",
  ENOENT: "It is no longer there",
  ENOTDIR: "Part of the path is not a folder",
  EISDIR: "A folder is in the way",
  EEXIST: "Something with that name is already there",
  ENOTEMPTY: "The folder is not empty",
  ENAMETOOLONG: "The path is too long",
  EIO: "The disk reported a read or write error",
  ENXIO: "The drive is no longer connected",
  ENODEV: "The drive is no longer connected",
  EMFILE: "Too many files are open",
  ENFILE: "Too many files are open",
  ETIMEDOUT: "The drive took too long to answer",
};
/** A failure in plain words, with the path it concerns when the system names one. */
export function messageOf(error: unknown): string {
  const plain = PLAIN[codeOf(error)];
  if (!plain) return error instanceof Error ? error.message : String(error);
  const where =
    error && typeof error === "object" && "path" in error && typeof error.path === "string"
      ? error.path
      : "";
  return where ? `${plain}: ${where}` : `${plain}.`;
}
const exists = async (p: string) => {
  try {
    return await fs.lstat(p);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return null;
    throw error;
  }
};
const entriesOf = async (dir: string) => {
  try {
    return await fs.readdir(dir);
  } catch (error) {
    // A folder the plan has yet to create holds nothing to collide with.
    if (codeOf(error) === "ENOENT") return [];
    throw error;
  }
};
/**
 * Lets other work run: timers, the window's requests. A loop over every file of a large
 * library calls it every `YIELD_EVERY` files, so it never holds up the main process for long.
 */
const giveWay = () => new Promise<void>((resolve) => setImmediate(resolve));
const YIELD_EVERY = 500;
const fingerprint = (stat: Stats): Fingerprint => ({
  dev: stat.dev,
  ino: stat.ino,
  size: stat.size,
  mtimeMs: stat.mtimeMs,
});
// Device and inode numbers are not compared: they change across remounts and are
// synthesized on some network shares, which would make undo refuse untouched files.
const same = (stat: Stats | null, expected: Fingerprint) =>
  !!stat &&
  stat.isFile() &&
  !stat.isSymbolicLink() &&
  stat.size === expected.size &&
  stat.mtimeMs === expected.mtimeMs;

export async function scanPaths(paths: string[]): Promise<ScanResult> {
  const files: MediaFile[] = [],
    unread: ScanResult["unread"] = [];
  const visited = new Set<string>();
  const found = new Set<string>();
  /** Runs one read; a failure is noted against the path and the rest of the import carries on. */
  async function reading<T>(where: string, read: () => Promise<T>): Promise<T | undefined> {
    try {
      return await read();
    } catch (error) {
      unread.push({ path: where, reason: PLAIN[codeOf(error)] ?? messageOf(error) });
      return undefined;
    }
  }
  async function visit(input: string, root: string) {
    const absolute = path.resolve(input);
    if (visited.has(absolute)) return;
    visited.add(absolute);
    if (visited.size > 20000)
      throw new Error(
        "Import is limited to 20,000 entries. Choose a smaller folder.",
      );
    const stat = await reading(absolute, () => fs.lstat(absolute));
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      unread.push({ path: absolute, reason: "A link to another place; links are not followed" });
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of (await reading(absolute, () => fs.readdir(absolute))) ?? []) {
        if (!entry.startsWith("."))
          await visit(path.join(absolute, entry), root);
      }
    } else if (
      stat.isFile() &&
      VIDEO_EXTENSIONS.includes(path.extname(absolute).slice(1).toLowerCase())
    ) {
      // Canonicalize the parent so alternate directory aliases cannot create duplicate operations.
      const parent = await reading(absolute, () => fs.realpath(path.dirname(absolute)));
      if (parent === undefined) return;
      const canonical = path.join(parent, path.basename(absolute));
      if (found.has(canonical)) return;
      found.add(canonical);
      files.push({
        id: randomUUID(),
        path: canonical,
        root,
        name: path.basename(canonical),
        size: stat.size,
        parsed: parseMediaPath(canonical, root),
      });
    }
  }
  for (const input of paths) {
    const absolute = path.resolve(input);
    // A chosen folder is the root its contents are organised within; a chosen file uses its own folder.
    const root = await reading(absolute, async () =>
      fs.realpath(
        (await fs.lstat(absolute)).isDirectory() ? absolute : path.dirname(absolute),
      ),
    );
    if (root !== undefined) await visit(absolute, root);
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), unread };
}

/**
 * Whether a folder's own name says it is this title's folder: "Show", "Show (1999)",
 * "Show.S01.1080p", or the name the template gives it.
 */
function isTitleFolder(name: string, media: MediaLike, rendered: string) {
  if (key(name) === key(rendered)) return true;
  const wanted = normalizeTitle(media.title);
  if (!wanted) return false;
  if (normalizeTitle(name) === wanted) return true;
  const parsed = parseStem(name);
  return (
    normalizeTitle(parsed.title) === wanted &&
    (parsed.year === null || !media.year || parsed.year === media.year)
  );
}

/**
 * Whether files can be moved into a folder, which needs them on the same drive: one that has
 * since gone missing is left for the preview to report.
 */
export async function onSameDrive(folder: string, files: string[]) {
  const { dev } = await fs.stat(folder);
  for (const file of files) {
    const stat = await exists(file);
    if (stat && stat.dev !== dev) return false;
  }
  return true;
}

async function moveOperation(
  source: string,
  target: string,
): Promise<MoveOperation> {
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Only regular files can be renamed.");
  return { type: "move", source, target, fingerprint: fingerprint(stat) };
}

export async function createPlan(
  selections: Selection[],
  options: PlanOptions = {},
): Promise<Plan> {
  if (!selections.length) throw new Error("Confirm at least one match first.");
  // Folders that must never be removed: where each file was added from, and above.
  const boundaries = [
    ...new Set(selections.map((item) => item.sourceRoot ?? item.file.root)),
  ];
  const templates = options.templates ?? PLEX_TEMPLATES;
  const operations: Operation[] = [],
    errors: string[] = [],
    previews: Plan["previews"] = [],
    sourceChecks: Plan["sourceChecks"] = [],
    issues: Plan["issues"] = [];
  // Folder listings as they will be once planned folders exist, each name under its key, so
  // a name is found without going through the folder: a large folder is read once per plan.
  const listings = new Map<string, Map<string, string>>();
  const mkdirs = new Map<string, MkdirOperation>();
  type Changes = Plan["previews"][number]["changes"];
  // Per source folder: where its videos are going. Per artwork slot: what would be downloaded.
  const departures = new Map<
    string,
    {
      folders: Set<string>;
      videos: Set<string>;
      kinds: Set<string>;
      /** The top folder each video's title is organised into, when the template has one. */
      titles: Set<string>;
      changes: Changes;
    }
  >();
  const wanted: {
    folder: string;
    stem: string;
    url: string | undefined;
    taken: (name: string) => boolean;
    changes: Changes;
  }[] = [];
  // NFO files on their way to a new name, and the ones that would be written if none arrives.
  const nfos = new Set<string>();
  const unwritten: { target: string; media: Selection["media"]; changes: Changes }[] = [];
  const list = async (dir: string) => {
    let entries = listings.get(dir);
    if (!entries) {
      entries = new Map();
      for (const name of await entriesOf(dir))
        if (!entries.has(key(name))) entries.set(key(name), name);
      listings.set(dir, entries);
    }
    return entries;
  };
  // Per source folder, read once: its subtitles and sidecars under the stem of the video each
  // is named after. A file goes with the longest video name it starts with, so
  // "Film-2-poster.jpg" belongs to "Film-2.mkv", not "Film.mkv".
  type Companion = { name: string; ext: string; subtitle: boolean; sidecar: boolean };
  const companions = new Map<string, Map<string, Companion[]>>();
  async function companionsOf(dir: string) {
    let owned = companions.get(dir);
    if (owned) return owned;
    const siblings = await fs.readdir(dir);
    const videoStems = new Set(siblings.filter(isVideo).map(stemOf));
    owned = new Map();
    for (const name of siblings) {
      const ext = path.extname(name).slice(1).toLowerCase();
      const subtitle = SUBTITLE_EXTENSIONS.includes(ext);
      const sidecar = SIDECAR_EXTENSIONS.includes(ext);
      if (!subtitle && !sidecar) continue;
      const stem = stemOf(name);
      // The stem itself, then each shorter name it continues with "." (or "-" for a sidecar).
      let owner = videoStems.has(stem) ? stem : null;
      for (let at = stem.length - 1; !owner && at > 0; at--)
        if ((stem[at] === "." || (sidecar && stem[at] === "-")) && videoStems.has(stem.slice(0, at)))
          owner = stem.slice(0, at);
      if (owner === null) continue;
      const list = owned.get(owner) ?? [];
      list.push({ name, ext, subtitle, sidecar });
      owned.set(owner, list);
    }
    companions.set(dir, owned);
    return owned;
  }
  // Reuses an existing folder whose name differs only by case or Unicode form, so one
  // show never ends up split across two folders.
  async function resolveFolder(root: string, names: string[]) {
    let current = root;
    for (const name of names) {
      const siblings = await list(current);
      const existing = siblings.get(key(name));
      current = path.join(current, existing ?? name);
      if (mkdirs.has(key(current))) continue;
      if (existing) {
        if (!(await fs.lstat(current)).isDirectory())
          throw new Error(`A file is in the way of the folder "${name}".`);
      } else {
        siblings.set(key(name), name);
        listings.set(current, new Map());
        mkdirs.set(key(current), { type: "mkdir", target: current });
      }
    }
    return current;
  }
  // Each file's name, rendered once. Rendering is the costliest part of planning that does not
  // wait on the disk, so it gives way to other work every so often.
  const rendered = new Map<Selection, { segments: string[] } | { error: unknown }>();
  for (const [index, selection] of selections.entries()) {
    if (index && index % YIELD_EVERY === 0) await giveWay();
    const { media } = selection;
    try {
      rendered.set(selection, {
        segments: renderTemplate(
          media.kind === "tv" ? templates.episode : templates.movie,
          media,
        ),
      });
    } catch (error) {
      rendered.set(selection, { error });
    }
  }
  /** A fresh copy of the selection's name, folders first; throws why it has none. */
  const segmentsOf = (selection: Selection) => {
    const result = rendered.get(selection)!;
    if ("error" in result) throw result.error;
    return [...result.segments];
  };
  // An imported folder that is itself one title's folder is renamed to the title's name, not
  // given a second title folder inside it: every file added from it is going to that one
  // title, and the folder is already named after it. Maps each such folder to its new path.
  const titleRoots = new Map<string, string>();
  if (options.organize !== false) {
    const named = new Map<string, Set<string> | null>();
    for (const selection of selections) {
      const { file, media, sourceRoot } = selection;
      if (named.get(file.root) === null) continue;
      let segments: string[];
      try {
        segments = segmentsOf(selection);
      } catch {
        // Reported against the file below.
        continue;
      }
      const [title = ""] = segments;
      named.set(
        file.root,
        segments.length > 1 &&
          (sourceRoot ?? file.root) === file.root &&
          isTitleFolder(path.basename(file.root), media, title)
          ? (named.get(file.root) ?? new Set<string>()).add(title)
          : null,
      );
    }
    const claimed = new Set<string>();
    for (const [root, names] of named) {
      const [name] = names ?? [];
      const parent = path.dirname(root);
      if (names?.size !== 1 || !name || parent === root) continue;
      const target = path.join(parent, name);
      // Another folder already has the name: the title folder is made inside, as usual.
      if (
        claimed.has(key(target)) ||
        (key(name) !== key(path.basename(root)) &&
          (await list(parent)).has(key(name)))
      )
        continue;
      claimed.add(key(target));
      titleRoots.set(root, target);
    }
  }
  // Copies that would take the same name are told apart before anything is planned.
  const versions = nameVersions(selections, (selection) => {
    const { file } = selection;
    const segments = segmentsOf(selection);
    return options.organize === false
      ? path.join(path.dirname(file.path), segments.pop()!)
      : path.join(file.root, ...segments);
  });
  for (const selection of selections) {
    const { file, media } = selection;
    const version = versions.get(selection);
    try {
      const stat = await fs.lstat(file.path);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("Only regular files can be processed.");
      sourceChecks.push({ source: file.path, fingerprint: fingerprint(stat) });
      const parent = path.dirname(file.path);
      const segments = segmentsOf(selection);
      const plainStem = segments.pop()!;
      const newStem = version ? safeName(`${plainStem} - ${version.label}`) : plainStem;
      const extension = path.extname(file.path).toLowerCase();
      const inTitle = titleRoots.has(file.root);
      const titleFolder = () =>
        inTitle ? file.root : resolveFolder(file.root, segments.slice(0, 1));
      const folder =
        options.organize === false
          ? parent
          : await resolveFolder(file.root, inTitle ? segments.slice(1) : segments);
      const target = path.join(folder, newStem + extension);
      const changes: Plan["previews"][number]["changes"] = [];
      const add = (op: Operation) => {
        operations.push(op);
        changes.push({
          source: op.type === "move" ? op.source : null,
          target: op.target,
        });
      };
      previews.push({
        source: file.path,
        target,
        title: media.episodeTitle || media.title,
        changes,
      });
      if (target !== file.path) {
        add(await moveOperation(file.path, target));
        if (version) changes.at(-1)!.note = version.note;
      }
      const oldStem = path.basename(file.path, path.extname(file.path));
      if (target !== file.path) {
        // Files named after the video travel with it: subtitles, its NFO, its artwork.
        const named = (await companionsOf(parent)).get(oldStem) ?? [];
        for (const { name: sibling, ext, subtitle, sidecar } of named) {
          if (
            !(subtitle && options.subtitles !== false) &&
            !(sidecar && options.sidecars !== false)
          )
            continue;
          const arriving = path.join(folder, `${newStem}${sibling.slice(oldStem.length)}`);
          add(await moveOperation(path.join(parent, sibling), arriving));
          if (ext === "nfo") nfos.add(key(arriving));
        }
        // Remember where this folder's videos are going, for the artwork that belongs to the folder.
        const leaving = departures.get(parent) ?? {
          folders: new Set<string>(),
          videos: new Set<string>(),
          kinds: new Set<string>(),
          titles: new Set<string>(),
          changes,
        };
        if (options.organize !== false && segments.length)
          leaving.titles.add(await titleFolder());
        leaving.folders.add(folder);
        leaving.videos.add(path.basename(file.path));
        leaving.kinds.add(media.kind);
        departures.set(parent, leaving);
      }
      // An NFO already waiting under the new name, which is what a correctly named video has
      // beside it, is kept rather than written over. Whether one is being moved there is only
      // known once every file has been planned.
      const nfoName = `${newStem}.nfo`;
      // A further version shares the NFO written for the plain name.
      if (
        options.nfo &&
        !version &&
        !(await list(folder)).has(key(nfoName))
      )
        unwritten.push({ target: path.join(folder, nfoName), media, changes });
      // Artwork belongs to a title's own folder, so it needs a template that makes one.
      // It is decided after the loop, once everything being moved into each folder is known.
      if (options.artwork && options.organize !== false && segments.length) {
        const artFolder = await titleFolder();
        for (const { stem, from, taken } of ARTWORK)
          wanted.push({
            folder: artFolder,
            stem,
            url: media[from],
            taken: (name) => (taken as readonly string[]).includes(name),
            changes,
          });
        // A season's poster sits beside its episodes, under the name Plex looks for there.
        const { season } = media;
        if (media.kind === "tv" && season !== undefined) {
          const pattern =
            season === 0
              ? /^season-?(specials|0?0)(-poster)?$/
              : new RegExp(`^season-?0?${season}(-poster)?$`);
          wanted.push({
            folder,
            stem:
              season === 0
                ? "season-specials-poster"
                : `season${String(season).padStart(2, "0")}-poster`,
            url: media.seasonPosterUrl,
            taken: (name) => pattern.test(name),
            changes,
          });
        }
      }
    } catch (error) {
      errors.push(`${file.name}: ${messageOf(error)}`);
      issues.push({ source: file.path, message: messageOf(error) });
    }
  }
  // An NFO the file already had is kept rather than written over. Two copies of one title in
  // different formats share a name, and so share one NFO, whichever of them brought it.
  for (const { target, media, changes } of unwritten) {
    if (nfos.has(key(target))) continue;
    nfos.add(key(target));
    operations.push({ type: "write", target, content: makeNfo(media) });
    changes.push({ source: null, target });
  }
  // A show's own files (tvshow.nfo, its poster and fanart) follow it to its new folder, but only
  // when the whole show is going: every video under the old show folder is in this batch and
  // they all end up under one title.
  if (options.sidecars !== false) {
    const shows = new Map<
      string,
      { titles: Set<string>; planned: Set<string>; flat: boolean; changes: Changes }
    >();
    for (const [dir, leaving] of departures) {
      if (!leaving.kinds.has("tv") || leaving.kinds.size !== 1) continue;
      const inSeason = SEASON_FOLDER.test(path.basename(dir));
      const showDir = inSeason ? path.dirname(dir) : dir;
      const show = shows.get(showDir) ?? {
        titles: new Set<string>(),
        planned: new Set<string>(),
        flat: false,
        changes: leaving.changes,
      };
      leaving.titles.forEach((title) => show.titles.add(title));
      leaving.videos.forEach((name) => show.planned.add(path.join(dir, name)));
      show.flat ||= !inSeason;
      shows.set(showDir, show);
    }
    for (const [showDir, show] of shows) {
      const [title] = show.titles;
      if (
        show.titles.size !== 1 ||
        !title ||
        title === showDir ||
        !boundaries.some((root) => showDir.startsWith(root + path.sep))
      )
        continue;
      const videos = await videosUnder(showDir);
      if (!videos || videos.some((video) => !show.planned.has(video))) continue;
      const occupied = await list(title);
      for (const name of await fs.readdir(showDir)) {
        // Season artwork kept in the show folder goes too, unless the episodes are also
        // in this folder, in which case it follows them in the next step.
        const wantedHere =
          SHOW_ASSET.test(name) || (!show.flat && SEASON_ASSET.test(name));
        if (!wantedHere || occupied.has(key(name))) continue;
        try {
          const source = path.join(showDir, name);
          const op = await moveOperation(source, path.join(title, name));
          operations.push(op);
          show.changes.push({ source, target: op.target });
        } catch {
          // Not a regular file: leave it where it is.
        }
      }
    }
  }
  // Artwork and NFO files that describe a whole folder (poster.jpg, movie.nfo, season01-poster.jpg)
  // follow its videos when all of them are going to the same place and none is staying behind.
  const moving = new Set(operations.flatMap((op) => (op.type === "move" ? [op.source] : [])));
  if (options.sidecars !== false)
    for (const [dir, leaving] of departures) {
      const [destination] = leaving.folders;
      if (
        leaving.folders.size !== 1 ||
        leaving.kinds.size !== 1 ||
        !destination ||
        destination === dir ||
        !boundaries.some((root) => dir.startsWith(root + path.sep))
      )
        continue;
      const entries = await fs.readdir(dir);
      if (entries.some((name) => isVideo(name) && !leaving.videos.has(name)))
        continue;
      // A show's episodes land in a season folder, so only season artwork follows them there.
      const belongs = leaving.kinds.has("tv") ? SEASON_ASSET : FOLDER_ASSET;
      const occupied = await list(destination);
      for (const name of entries) {
        if (!belongs.test(name) || occupied.has(key(name))) continue;
        const source = path.join(dir, name);
        if (moving.has(source)) continue;
        try {
          const op = await moveOperation(source, path.join(destination, name));
          operations.push(op);
          moving.add(source);
          leaving.changes.push({ source, target: op.target });
        } catch {
          // Not a regular file: leave it where it is.
        }
      }
    }
  const artwork = new Set<string>();
  // What each folder will be given, by name.
  const arrivals = new Map<string, string[]>();
  const arrive = (op: Operation) => {
    const folder = path.dirname(op.target);
    const names = arrivals.get(folder) ?? [];
    names.push(path.basename(op.target));
    arrivals.set(folder, names);
  };
  operations.forEach(arrive);
  for (const { folder, stem, url, taken, changes } of wanted) {
    const slot = `${key(folder)}/${stem}`;
    if (!isArtworkUrl(url) || artwork.has(slot)) continue;
    artwork.add(slot);
    // Whatever artwork is there, or on its way there, stays; nothing is replaced.
    const present = [...(await list(folder)).values(), ...(arrivals.get(folder) ?? [])].some(
      (name) =>
        IMAGE.test(name) && taken(name.replace(IMAGE, "").toLowerCase()),
    );
    if (present) continue;
    const extension = IMAGE.exec(new URL(url).pathname)?.[0] ?? ".jpg";
    const op: Operation = {
      type: "download",
      url,
      target: path.join(folder, stem + extension.toLowerCase()),
    };
    operations.push(op);
    arrive(op);
    changes.push({ source: null, target: op.target, artwork: true });
  }
  const targets = new Map<string, Operation>(),
    sources = new Set<string>();
  // Enough of a path to tell apart two files with the same name in different folders.
  const shortPath = (file: string) =>
    path.join(path.basename(path.dirname(file)), path.basename(file));
  for (const [index, op] of operations.entries()) {
    if (index && index % YIELD_EVERY === 0) await giveWay();
    try {
      const targetKey = key(op.target);
      const other = targets.get(targetKey);
      if (other)
        throw new Error(
          other.type === "move" && op.type === "move"
            ? `Two operations have the same destination: "${shortPath(other.source)}" and "${shortPath(op.source)}".`
            : "Two operations have the same destination.",
        );
      targets.set(targetKey, op);
      if (op.type === "move") {
        if (sources.has(key(op.source)))
          throw new Error("A source file appears more than once.");
        sources.add(key(op.source));
      }
      if ((await list(path.dirname(op.target))).has(key(path.basename(op.target))))
        throw new Error(
          "Destination already exists (including case-only or Unicode-equivalent names).",
        );
    } catch (error) {
      errors.push(`${path.basename(op.target)}: ${messageOf(error)}`);
      issues.push({ target: op.target, message: messageOf(error) });
    }
  }
  // A folder whose name differs only by case is kept as it is, like any other.
  const renames: RenameOperation[] = [...titleRoots]
    .filter(([root, target]) => key(root) !== key(target))
    .map(([source, target]) => ({ type: "rename", source, target }));
  if (!operations.length && !renames.length && !errors.length)
    errors.push("These files already have their proposed names.");
  const rmdirs =
    options.removeEmpty === false || errors.length
      ? []
      : await emptiedFolders(operations, boundaries);
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    previews,
    sourceChecks,
    // Folders first, parents before children, so every move has somewhere to land;
    // emptied source folders after, children before parents; an imported folder takes
    // its new name last, once nothing else needs its old one.
    operations: [...mkdirs.values(), ...operations, ...rmdirs, ...renames],
    errors,
    issues,
  };
}

/**
 * Source folders that will hold nothing once the moves are done. A folder qualifies only
 * if every entry in it today is being moved out or is itself a qualifying folder, it lies
 * strictly inside the folder its files were added from, and nothing is being moved into
 * it or below it. Anything else in a folder, hidden files included, keeps it.
 */
async function emptiedFolders(
  operations: Operation[],
  boundaries: string[],
): Promise<RmdirOperation[]> {
  const leaving = new Map<string, Set<string>>();
  // Every folder something is moved or written into, and every folder above one.
  const receiving = new Set<string>();
  for (const op of operations) {
    for (
      let dir = key(path.dirname(op.target));
      !receiving.has(dir);
      dir = path.dirname(dir)
    ) {
      receiving.add(dir);
      if (path.dirname(dir) === dir) break;
    }
    if (op.type !== "move") continue;
    const from = path.dirname(op.source);
    if (from === path.dirname(op.target)) continue;
    if (!leaving.has(from)) leaving.set(from, new Set());
    leaving.get(from)!.add(path.basename(op.source));
  }
  const removable = (dir: string) =>
    boundaries.some((root) => dir.startsWith(root + path.sep)) &&
    !receiving.has(key(dir));
  const removed = new Set<string>();
  // Deepest first, so a parent is judged after the children that might empty it.
  const deeper = (a: string, b: string) => b.length - a.length;
  const pending = [...leaving.keys()].sort(deeper);
  for (let dir = pending.shift(); dir; dir = pending.shift()) {
    if (removed.has(dir) || !removable(dir)) continue;
    const moved = leaving.get(dir);
    const left = (await entriesOf(dir)).filter(
      (name) => !moved?.has(name) && !removed.has(path.join(dir!, name)),
    );
    if (left.length) continue;
    removed.add(dir);
    // Its parent, after every folder at least as deep.
    const parent = path.dirname(dir);
    let low = 0,
      high = pending.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (pending[middle]!.length >= parent.length) low = middle + 1;
      else high = middle;
    }
    pending.splice(low, 0, parent);
  }
  return [...removed]
    .sort((a, b) => b.length - a.length)
    .map((target) => ({ type: "rmdir", target }));
}

/** Saves one image, refusing anything that is not a reasonably sized image; returns its size. */
async function download(
  op: { url: string; target: string },
  fetcher: typeof fetch,
): Promise<number> {
  if (!isArtworkUrl(op.url))
    throw new Error("The image address is not from a known source.");
  let response: Response;
  try {
    response = await fetcher(op.url, {
      headers: { Accept: "image/*", "User-Agent": "Organtic/0.1" },
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
  } catch {
    throw new Error("The image source could not be reached.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`The image source returned HTTP ${response.status}.`);
  }
  const tooLarge = () => new Error("The image is larger than 20 MB.");
  if (
    !/^image\/(jpeg|png|webp)\b/.test(response.headers.get("content-type") ?? "")
  ) {
    await response.body?.cancel();
    throw new Error("The source did not return an image.");
  }
  if (Number(response.headers.get("content-length")) > ARTWORK_LIMIT) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > ARTWORK_LIMIT) throw tooLarge();
    chunks.push(chunk);
  }
  if (!size) throw new Error("The source returned an empty image.");
  const handle = await fs.open(op.target, "wx", 0o644);
  try {
    await handle.writeFile(Buffer.concat(chunks));
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.rm(op.target, { force: true });
    throw error;
  }
  await handle.close();
  return size;
}

async function append(file: string, event: JournalEvent) {
  const handle = await fs.open(file, "a", 0o600);
  try {
    await handle.writeFile(JSON.stringify(event) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// What link() reports on volumes without hard links (exFAT, FAT, many SMB and FUSE mounts).
const LINK_UNSUPPORTED = new Set([
  "EPERM",
  "EACCES",
  "ENOTSUP",
  "EOPNOTSUPP",
  "ENOSYS",
  "EMLINK",
  "EINVAL",
  "UNKNOWN",
]);

async function noReplaceMove(op: Omit<MoveOperation, "type">, io: FileOps) {
  const before = await fs.lstat(op.source);
  if (!same(before, op.fingerprint))
    throw new Error(`File changed since preview: ${op.source}`);
  try {
    // link() fails if the target exists, unlike rename(). No overwrite window.
    await io.link(op.source, op.target);
  } catch (error) {
    if (codeOf(error) === "EXDEV")
      throw new Error(
        `The destination is on a different drive, which is not supported: ${op.target}`,
      );
    if (!LINK_UNSUPPORTED.has(codeOf(error))) throw error;
    // No hard links here. rename() would replace an existing target, so check first; a
    // file created at the target in the instant between the check and the rename is the
    // one case this cannot rule out.
    if (await exists(op.target))
      throw new Error(`Destination already exists: ${op.target}`);
    await io.rename(op.source, op.target);
    if (!same(await fs.lstat(op.target), op.fingerprint))
      throw new Error(
        "File changed during rename. Inspect the journal before recovery.",
      );
    return;
  }
  const sameFile = (stat: Stats) =>
    stat.dev === before.dev && stat.ino === before.ino;
  if (
    !sameFile(await fs.lstat(op.source)) ||
    !sameFile(await fs.lstat(op.target))
  )
    throw new Error(
      "File changed during rename. Inspect the journal before recovery.",
    );
  await fs.unlink(op.source);
}

/** What `checkRoom` asks the system; tests replace these to stand in for a full or read-only disk. */
export type RoomProbe = Pick<typeof fs, "statfs" | "access">;
// A poster or backdrop is usually well under this; the real size is not known until it arrives.
const ARTWORK_ROOM = 2 * 1024 * 1024;
const megabytes = (bytes: number) =>
  bytes < 1024 * 1024 ? "under 1 MB" : `${Math.ceil(bytes / (1024 * 1024))} MB`;

/**
 * Reasons a plan cannot be carried out where it is headed, found without changing a file:
 * a folder that cannot be written to, or a disk without room for what the batch writes.
 * Moves stay on one disk and take no room; NFO files, artwork and the history record do.
 */
export async function checkRoom(
  plan: Plan,
  journalDir: string,
  probe: RoomProbe = fs,
): Promise<string[]> {
  const problems: string[] = [];
  try {
    await fs.mkdir(journalDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    return [`The history folder cannot be created, so the batch could not be undone. ${messageOf(error)}`];
  }
  // The folder each change lands in, as far as it exists yet, with the bytes written there.
  const needs = new Map<string, number>();
  const need = async (folder: string, bytes: number) => {
    let existing = folder;
    while (!(await exists(existing)) && path.dirname(existing) !== existing)
      existing = path.dirname(existing);
    needs.set(existing, (needs.get(existing) ?? 0) + bytes);
  };
  // The plan is written to the record once, and each change adds a line or two.
  await need(journalDir, Buffer.byteLength(JSON.stringify(plan)) + plan.operations.length * 128);
  for (const op of plan.operations) {
    if (op.type === "rmdir") continue;
    await need(
      path.dirname(op.target),
      op.type === "write"
        ? Buffer.byteLength(op.content)
        : op.type === "download"
          ? ARTWORK_ROOM
          : 0,
    );
    // Taking a file out of its folder changes that folder too.
    if (op.type === "move" || op.type === "rename") await need(path.dirname(op.source), 0);
  }
  const disks = new Map<string, { folder: string; bytes: number; free: number }>();
  for (const [folder, bytes] of needs) {
    const what = folder === journalDir ? "The history folder" : folder;
    try {
      await probe.access(folder, fs.constants.W_OK);
    } catch (error) {
      problems.push(
        codeOf(error) === "EROFS"
          ? `${what} is on a read-only disk.`
          : `${what} cannot be changed. ${messageOf(error)}`,
      );
      continue;
    }
    try {
      const [space, stat] = await Promise.all([probe.statfs(folder), fs.stat(folder)]);
      // Some network and virtual drives report no size at all; nothing can be said about those.
      if (!space.blocks) continue;
      const disk = disks.get(String(stat.dev)) ?? { folder: what, bytes: 0, free: space.bavail * space.bsize };
      disk.bytes += bytes;
      disks.set(String(stat.dev), disk);
    } catch {
      // A drive that cannot report its free space is left for the batch itself to find out.
    }
  }
  for (const disk of disks.values())
    if (disk.bytes > disk.free)
      problems.push(
        `Not enough room on the disk holding ${disk.folder}: this batch writes about ${megabytes(disk.bytes)} and ${megabytes(disk.free)} is free.`,
      );
  return problems;
}

/**
 * A batch that stopped before its first change: no file was touched and nothing was
 * journalled as started, so whatever the batch was made from can still be trusted.
 */
export class BatchNotStarted extends Error {
  readonly started = false;
}

/** The journal format this build writes, and the newest it can read. */
export const JOURNAL_VERSION = 1;

/** What a batch or an undo reports when it was asked to stop between operations. */
export const STOPPED = "You stopped the batch.";

/**
 * Applies a plan. When `signal` is aborted, the operation in hand finishes and the batch
 * stops before the next one, journalled as stopped like any other failure.
 */
export async function applyPlan(
  plan: Plan,
  journalDir: string,
  io: FileOps = fs,
  signal?: AbortSignal,
) {
  if (signal?.aborted)
    throw new BatchNotStarted(`${STOPPED} Nothing was changed.`);
  try {
    await checkPlan(plan, journalDir);
  } catch (error) {
    throw new BatchNotStarted(messageOf(error), { cause: error });
  }
  const journal = path.join(journalDir, `${plan.id}.jsonl`);
  let created = false;
  try {
    await fs.writeFile(journal, "", { flag: "wx", mode: 0o600 });
    created = true;
    await append(journal, { type: "plan", version: JOURNAL_VERSION, plan });
  } catch (error) {
    // The record is written before the first change, so a batch without one never began.
    // Only a record this call made is removed; one already there belongs to another batch.
    if (created) await fs.rm(journal, { force: true }).catch(() => {});
    throw new BatchNotStarted(
      `The history record could not be written, so nothing was changed. ${messageOf(error)}`,
      { cause: error },
    );
  }
  return runPlan(plan, journal, io, signal);
}

/** Rechecks the entire batch before touching the first file. */
async function checkPlan(plan: Plan, journalDir: string) {
  if (plan.errors.length || !plan.operations.length)
    throw new Error("Resolve preview conflicts first.");
  for (const check of plan.sourceChecks || []) {
    if (!same(await exists(check.source), check.fingerprint))
      throw new Error("A source changed. Generate a fresh preview.");
  }
  // Each destination folder is read once, however many files go into it.
  const listings = new Map<string, Set<string>>();
  for (const op of plan.operations) {
    if (op.type === "mkdir" || op.type === "rmdir") continue;
    if (op.type === "move" && !same(await exists(op.source), op.fingerprint))
      throw new Error("A source changed. Generate a fresh preview.");
    const folder = path.dirname(op.target);
    let names = listings.get(folder);
    if (!names) listings.set(folder, (names = new Set((await entriesOf(folder)).map(key))));
    if (names.has(key(path.basename(op.target))))
      throw new Error("A destination now exists. Generate a fresh preview.");
  }
  const [blocked] = await checkRoom(plan, journalDir);
  if (blocked) throw new Error(blocked);
}

async function runPlan(
  plan: Plan,
  journal: string,
  io: FileOps,
  signal?: AbortSignal,
) {
  let completed = 0;
  const warnings: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  try {
    for (const [index, op] of plan.operations.entries()) {
      if (signal?.aborted) throw new Error(STOPPED);
      await append(journal, { type: "intent", index });
      let size: number | undefined;
      if (op.type === "move") await noReplaceMove(op, io);
      else if (op.type === "download") {
        try {
          size = await download(op, io.fetch ?? fetch);
        } catch (error) {
          // Artwork is a nicety; the renames it accompanies still go ahead.
          const message = messageOf(error);
          warnings.push(`${path.basename(op.target)}: ${message}`);
          await append(journal, { type: "skipped", index, message });
          continue;
        }
      }
      else if (op.type === "mkdir") {
        try {
          await fs.mkdir(op.target);
        } catch (error) {
          // Someone created the folder since the preview; use it.
          if (
            codeOf(error) !== "EEXIST" ||
            !(await fs.lstat(op.target)).isDirectory()
          )
            throw error;
        }
      } else if (op.type === "rmdir") {
        try {
          await fs.rmdir(op.target);
        } catch (error) {
          // Something appeared in the folder since the preview, or it is already gone: leave it.
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(codeOf(error)))
            throw error;
        }
      } else if (op.type === "rename") {
        try {
          // rename() would replace an empty folder of the same name, so check first.
          if (await exists(op.target))
            throw new Error("A folder with the new name already exists.");
          await fs.rename(op.source, op.target);
          renamed.push({ from: op.source, to: op.target });
        } catch (error) {
          // Everything inside is already in place; the folder just keeps its old name.
          const message = messageOf(error);
          warnings.push(`${path.basename(op.source)}: ${message}`);
          await append(journal, { type: "skipped", index, message });
          continue;
        }
      } else if (op.type === "write") {
        const handle = await fs.open(op.target, "wx", 0o644);
        try {
          await handle.writeFile(op.content);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      completed++;
      await append(journal, {
        type: "done",
        index,
        ...(size === undefined ? {} : { size }),
      });
    }
    await append(journal, { type: "complete" });
    return { id: plan.id, completed, warnings, renamed };
  } catch (error) {
    await append(journal, { type: "failed", message: messageOf(error) }).catch(
      () => {},
    );
    throw Object.assign(
      new Error(
        `Stopped after ${completed} operations: ${messageOf(error)} Open History to review or undo this batch.`,
      ),
      { renamed },
    );
  }
}

async function readJournal(file: string, repairTail = false) {
  const raw = await fs.readFile(file, "utf8");
  const lines = raw.split("\n");
  const events: JournalEvent[] = [];
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      if (i < lines.length - 1)
        throw new Error("Journal is damaged; manual recovery is required.");
      if (repairTail)
        await fs.truncate(
          file,
          Buffer.byteLength(raw.slice(0, raw.lastIndexOf("\n") + 1)),
        );
    }
  }
  const first = events[0];
  if (first?.type !== "plan") throw new Error("Journal is missing its plan.");
  // Journals written before the format had a version are version 1.
  const version = first.version ?? 1;
  if (!Number.isInteger(version) || version < 1 || version > JOURNAL_VERSION)
    throw new Error(
      "This history record was written by a newer version of Organtic. Update the app to read or undo it.",
    );
  return { plan: first.plan, events };
}

const indexesOf = (events: JournalEvent[], type: "intent" | "undo-done") =>
  new Set(events.flatMap((e) => (e.type === type ? [e.index] : [])));

export async function history(journalDir: string): Promise<BatchSummary[]> {
  await fs.mkdir(journalDir, { recursive: true, mode: 0o700 });
  const result: BatchSummary[] = [];
  for (const name of (await fs.readdir(journalDir)).filter((name) =>
    name.endsWith(".jsonl"),
  )) {
    try {
      const { plan, events } = await readJournal(path.join(journalDir, name));
      const finished = events.some((e) => e.type === "complete");
      const failed = events.find((e) => e.type === "failed");
      // Without a recorded failure the app itself stopped: closed, crashed, or lost power.
      const stop = finished
        ? undefined
        : failed?.type === "failed"
          ? failed.message
          : "The app closed before the batch finished.";
      const started = indexesOf(events, "intent");
      const outcomeOf = (index: number): Pick<BatchSummary["operations"][number], "outcome" | "message"> => {
        const last = events.findLast(
          (e) => (e.type === "done" || e.type === "skipped") && e.index === index,
        );
        if (last?.type === "done") return { outcome: "done" };
        if (last?.type === "skipped") return { outcome: "skipped", message: last.message };
        if (!started.has(index)) return { outcome: "pending" };
        return { outcome: "failed", message: stop ?? "" };
      };
      result.push({
        id: plan.id,
        createdAt: plan.createdAt,
        count: plan.operations.length,
        status: events.some((e) => e.type === "undone")
          ? "undone"
          : finished
            ? "complete"
            : "interrupted",
        ...(stop === undefined ? {} : { stopped: stop }),
        operations: plan.operations.map((op, index) => ({
          source:
            op.type === "move" || op.type === "rename" ? op.source : undefined,
          target: op.target,
          type: op.type,
          ...outcomeOf(index),
        })),
      });
    } catch {
      result.push({
        id: name.replace(".jsonl", ""),
        status: "damaged",
        count: 0,
        createdAt: "",
        operations: [],
      });
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Puts a batch back. When `signal` is aborted, the operation in hand is put back and undo stops
 * before the next one; each step is already journalled, so the next undo carries on from there.
 */
export async function undoBatch(
  id: string,
  journalDir: string,
  io: FileOps = fs,
  signal?: AbortSignal,
) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid batch.");
  const file = path.join(journalDir, `${id}.jsonl`);
  const { plan, events } = await readJournal(file, true);
  if (events.some((e) => e.type === "undone"))
    throw new Error("This batch has already been undone.");
  const started = indexesOf(events, "intent");
  const reversed = indexesOf(events, "undo-done");
  const renamed: { from: string; to: string }[] = [];
  for (const [index, op] of [...plan.operations.entries()].reverse()) {
    if (!started.has(index) || reversed.has(index)) continue;
    if (signal?.aborted)
      throw Object.assign(
        new Error(
          "You stopped the undo part-way. Undo the batch again from History to put back the rest.",
        ),
        { renamed },
      );
    if (op.type === "mkdir") {
      try {
        await fs.rmdir(op.target);
      } catch (error) {
        // A folder that has gained other contents, or is already gone, is left as it is.
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(codeOf(error)))
          throw error;
      }
      await append(file, { type: "undo-done", index });
      continue;
    }
    if (op.type === "download") {
      // Remove the image only if it is still the one this batch saved.
      const saved = await exists(op.target);
      const size = events.find(
        (e) => e.type === "done" && e.index === index && "size" in e,
      );
      if (
        saved?.isFile() &&
        size?.type === "done" &&
        saved.size === size.size
      )
        await fs.unlink(op.target);
      await append(file, { type: "undo-done", index });
      continue;
    }
    if (op.type === "rename") {
      const source = await exists(op.source);
      const target = await exists(op.target);
      if (target && !source) {
        await fs.rename(op.target, op.source);
        renamed.push({ from: op.target, to: op.source });
      } else if (
        target &&
        events.some((e) => e.type === "done" && e.index === index)
      )
        throw new Error(
          `Both folder names are in use; recovery stopped: ${op.source}`,
        );
      await append(file, { type: "undo-done", index });
      continue;
    }
    if (op.type === "rmdir") {
      // Put the removed folder back so the files can return to it.
      await fs.mkdir(op.target, { recursive: true });
      await append(file, { type: "undo-done", index });
      continue;
    }
    const target = await exists(op.target);
    if (op.type === "write") {
      if (target) {
        if (
          !target.isFile() ||
          target.isSymbolicLink() ||
          (await fs.readFile(op.target, "utf8")) !== op.content
        )
          throw new Error(`Metadata changed; recovery stopped: ${op.target}`);
        await fs.unlink(op.target);
      }
    } else {
      const source = await exists(op.source);
      // Started but never done, with the file still at its old name and something else at the
      // new one: the move never happened, and what is at the target is not this batch's to touch.
      if (
        target &&
        same(source, op.fingerprint) &&
        (target.dev !== source!.dev || target.ino !== source!.ino) &&
        !events.some((e) => e.type === "done" && e.index === index)
      ) {
        await append(file, { type: "undo-done", index });
        continue;
      }
      if (source && !same(source, op.fingerprint))
        throw new Error(
          `Original path is occupied; recovery stopped: ${op.source}`,
        );
      if (target && !same(target, op.fingerprint))
        throw new Error(`Renamed file changed; recovery stopped: ${op.target}`);
      if (!target && !source)
        throw new Error(
          `Both paths are missing; recovery stopped: ${op.source}`,
        );
      if (target && !source)
        await noReplaceMove(
          { source: op.target, target: op.source, fingerprint: op.fingerprint },
          io,
        );
      else if (target && source) {
        // Interrupted after link, before unlink: both names must be the same file.
        if (target.dev !== source.dev || target.ino !== source.ino)
          throw new Error(
            `Both paths hold separate files; recovery stopped: ${op.source}`,
          );
        await fs.unlink(op.target);
      }
    }
    await append(file, { type: "undo-done", index });
  }
  await append(file, { type: "undone" });
  return { id, renamed };
}
