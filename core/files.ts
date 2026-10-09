import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS, makeNfo } from "./media.ts";
import { parseMediaPath } from "./parse.ts";
import { PLEX_TEMPLATES, renderTemplate } from "./naming.ts";
import type {
  BatchSummary,
  Fingerprint,
  JournalEvent,
  MediaFile,
  MkdirOperation,
  MoveOperation,
  Operation,
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
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const codeOf = (error: unknown) =>
  error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
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
    skipped: string[] = [];
  const visited = new Set<string>();
  async function visit(input: string, root: string) {
    const absolute = path.resolve(input);
    if (visited.has(absolute)) return;
    visited.add(absolute);
    if (visited.size > 20000)
      throw new Error(
        "Import is limited to 20,000 entries. Choose a smaller folder.",
      );
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      skipped.push(absolute);
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of await fs.readdir(absolute)) {
        if (!entry.startsWith("."))
          await visit(path.join(absolute, entry), root);
      }
    } else if (
      stat.isFile() &&
      VIDEO_EXTENSIONS.includes(path.extname(absolute).slice(1).toLowerCase())
    ) {
      // Canonicalize the parent so alternate directory aliases cannot create duplicate operations.
      const canonical = path.join(
        await fs.realpath(path.dirname(absolute)),
        path.basename(absolute),
      );
      if (!files.some((file) => file.path === canonical))
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
    const stat = await fs.lstat(absolute);
    // A chosen folder is the root its contents are organised within; a chosen file uses its own folder.
    await visit(
      absolute,
      await fs.realpath(stat.isDirectory() ? absolute : path.dirname(absolute)),
    );
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), skipped };
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
  // Folder listings as they will be once planned folders exist.
  const listings = new Map<string, string[]>();
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
  const list = async (dir: string) => {
    let entries = listings.get(dir);
    if (!entries) listings.set(dir, (entries = await entriesOf(dir)));
    return entries;
  };
  // Reuses an existing folder whose name differs only by case or Unicode form, so one
  // show never ends up split across two folders.
  async function resolveFolder(root: string, names: string[]) {
    let current = root;
    for (const name of names) {
      const siblings = await list(current);
      const existing = siblings.find((entry) => key(entry) === key(name));
      current = path.join(current, existing ?? name);
      if (mkdirs.has(key(current))) continue;
      if (existing) {
        if (!(await fs.lstat(current)).isDirectory())
          throw new Error(`A file is in the way of the folder "${name}".`);
      } else {
        siblings.push(name);
        listings.set(current, []);
        mkdirs.set(key(current), { type: "mkdir", target: current });
      }
    }
    return current;
  }
  for (const { file, media } of selections) {
    try {
      const stat = await fs.lstat(file.path);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("Only regular files can be processed.");
      sourceChecks.push({ source: file.path, fingerprint: fingerprint(stat) });
      const parent = path.dirname(file.path);
      const segments = renderTemplate(
        media.kind === "tv" ? templates.episode : templates.movie,
        media,
      );
      const newStem = segments.pop()!;
      const extension = path.extname(file.path).toLowerCase();
      const folder =
        options.organize === false
          ? parent
          : await resolveFolder(file.root, segments);
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
      if (target !== file.path) add(await moveOperation(file.path, target));
      const oldStem = path.basename(file.path, path.extname(file.path));
      let hasNfo = false;
      if (target !== file.path) {
        // Files named after the video travel with it: subtitles, its NFO, its artwork.
        const siblings = await fs.readdir(parent);
        const videoStems = siblings.filter(isVideo).map(stemOf);
        for (const sibling of siblings) {
          const ext = path.extname(sibling).slice(1).toLowerCase();
          const subtitle = SUBTITLE_EXTENSIONS.includes(ext);
          const sidecar = SIDECAR_EXTENSIONS.includes(ext);
          if (
            !(subtitle && options.subtitles !== false) &&
            !(sidecar && options.sidecars !== false)
          )
            continue;
          const stem = stemOf(sibling);
          const named = (video: string) =>
            stem === video ||
            stem.startsWith(`${video}.`) ||
            (sidecar && stem.startsWith(`${video}-`));
          // "Film-2-poster.jpg" belongs to "Film-2.mkv", not "Film.mkv".
          if (
            !named(oldStem) ||
            videoStems.some((v) => v.length > oldStem.length && named(v))
          )
            continue;
          add(
            await moveOperation(
              path.join(parent, sibling),
              path.join(folder, `${newStem}${sibling.slice(oldStem.length)}`),
            ),
          );
          hasNfo ||= ext === "nfo" && stem === oldStem;
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
          leaving.titles.add(
            await resolveFolder(file.root, segments.slice(0, 1)),
          );
        leaving.folders.add(folder);
        leaving.videos.add(path.basename(file.path));
        leaving.kinds.add(media.kind);
        departures.set(parent, leaving);
      }
      // An NFO the file already had is kept rather than written over, as is one already
      // waiting under the new name, which is what a correctly named video has beside it.
      const nfoName = `${newStem}.nfo`;
      hasNfo ||= (await list(folder)).some((name) => key(name) === key(nfoName));
      if (options.nfo && !hasNfo)
        add({
          type: "write",
          target: path.join(folder, nfoName),
          content: makeNfo(media),
        });
      // Artwork belongs to a title's own folder, so it needs a template that makes one.
      // It is decided after the loop, once everything being moved into each folder is known.
      if (options.artwork && options.organize !== false && segments.length) {
        const titleFolder = await resolveFolder(file.root, segments.slice(0, 1));
        for (const { stem, from, taken } of ARTWORK)
          wanted.push({
            folder: titleFolder,
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
      const occupied = new Set((await list(title)).map(key));
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
      const occupied = new Set((await list(destination)).map(key));
      for (const name of entries) {
        if (!belongs.test(name) || occupied.has(key(name))) continue;
        const source = path.join(dir, name);
        if (operations.some((op) => op.type === "move" && op.source === source))
          continue;
        try {
          const op = await moveOperation(source, path.join(destination, name));
          operations.push(op);
          leaving.changes.push({ source, target: op.target });
        } catch {
          // Not a regular file: leave it where it is.
        }
      }
    }
  const artwork = new Set<string>();
  for (const { folder, stem, url, taken, changes } of wanted) {
    const slot = `${key(folder)}/${stem}`;
    if (!isArtworkUrl(url) || artwork.has(slot)) continue;
    artwork.add(slot);
    // Whatever artwork is there, or on its way there, stays; nothing is replaced.
    const arriving = operations
      .filter((op) => path.dirname(op.target) === folder)
      .map((op) => path.basename(op.target));
    const present = [...(await list(folder)), ...arriving].some(
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
    changes.push({ source: null, target: op.target, artwork: true });
  }
  const targets = new Set<string>(),
    sources = new Set<string>();
  for (const op of operations) {
    try {
      const targetKey = key(op.target);
      if (targets.has(targetKey))
        throw new Error("Two operations have the same destination.");
      targets.add(targetKey);
      if (op.type === "move") {
        if (sources.has(key(op.source)))
          throw new Error("A source file appears more than once.");
        sources.add(key(op.source));
      }
      const siblings = await list(path.dirname(op.target));
      if (siblings.some((name) => key(name) === key(path.basename(op.target))))
        throw new Error(
          "Destination already exists (including case-only or Unicode-equivalent names).",
        );
    } catch (error) {
      errors.push(`${path.basename(op.target)}: ${messageOf(error)}`);
      issues.push({ target: op.target, message: messageOf(error) });
    }
  }
  if (!operations.length && !errors.length)
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
    // emptied source folders last, children before parents.
    operations: [...mkdirs.values(), ...operations, ...rmdirs],
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
  const receiving: string[] = [];
  for (const op of operations) {
    receiving.push(key(path.dirname(op.target)) + path.sep);
    if (op.type !== "move") continue;
    const from = path.dirname(op.source);
    if (from === path.dirname(op.target)) continue;
    if (!leaving.has(from)) leaving.set(from, new Set());
    leaving.get(from)!.add(path.basename(op.source));
  }
  const removable = (dir: string) =>
    boundaries.some((root) => dir.startsWith(root + path.sep)) &&
    !receiving.some((target) => target.startsWith(key(dir) + path.sep));
  const removed = new Set<string>();
  const pending = [...leaving.keys()];
  // Deepest first, so a parent is judged after the children that might empty it.
  for (let dir = pending.shift(); dir; dir = pending.shift()) {
    if (removed.has(dir) || !removable(dir)) continue;
    const moved = leaving.get(dir);
    const left = (await entriesOf(dir)).filter(
      (name) => !moved?.has(name) && !removed.has(path.join(dir!, name)),
    );
    if (left.length) continue;
    removed.add(dir);
    pending.push(path.dirname(dir));
    pending.sort((a, b) => b.length - a.length);
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

export async function applyPlan(
  plan: Plan,
  journalDir: string,
  io: FileOps = fs,
) {
  if (plan.errors.length || !plan.operations.length)
    throw new Error("Resolve preview conflicts first.");
  // Recheck the entire batch before touching the first file.
  for (const check of plan.sourceChecks || []) {
    if (!same(await exists(check.source), check.fingerprint))
      throw new Error("A source changed. Generate a fresh preview.");
  }
  for (const op of plan.operations) {
    if (op.type === "mkdir" || op.type === "rmdir") continue;
    if (op.type === "move" && !same(await exists(op.source), op.fingerprint))
      throw new Error("A source changed. Generate a fresh preview.");
    if (
      (await entriesOf(path.dirname(op.target))).some(
        (name) => key(name) === key(path.basename(op.target)),
      )
    )
      throw new Error("A destination now exists. Generate a fresh preview.");
  }
  await fs.mkdir(journalDir, { recursive: true, mode: 0o700 });
  const journal = path.join(journalDir, `${plan.id}.jsonl`);
  await fs.writeFile(journal, "", { flag: "wx", mode: 0o600 });
  await append(journal, { type: "plan", plan });
  let completed = 0;
  const warnings: string[] = [];
  try {
    for (const [index, op] of plan.operations.entries()) {
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
    return { id: plan.id, completed, warnings };
  } catch (error) {
    await append(journal, { type: "failed", message: messageOf(error) }).catch(
      () => {},
    );
    throw new Error(
      `Stopped after ${completed} operations: ${messageOf(error)} Open History to review or undo this batch.`,
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
      result.push({
        id: plan.id,
        createdAt: plan.createdAt,
        count: plan.operations.length,
        status: events.some((e) => e.type === "undone")
          ? "undone"
          : events.some((e) => e.type === "complete")
            ? "complete"
            : "interrupted",
        operations: plan.operations.map((op) => ({
          source: op.type === "move" ? op.source : undefined,
          target: op.target,
          type: op.type,
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

export async function undoBatch(
  id: string,
  journalDir: string,
  io: FileOps = fs,
) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid batch.");
  const file = path.join(journalDir, `${id}.jsonl`);
  const { plan, events } = await readJournal(file, true);
  if (events.some((e) => e.type === "undone"))
    throw new Error("This batch has already been undone.");
  const started = indexesOf(events, "intent");
  const reversed = indexesOf(events, "undo-done");
  for (const [index, op] of [...plan.operations.entries()].reverse()) {
    if (!started.has(index) || reversed.has(index)) continue;
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
  return { id };
}
