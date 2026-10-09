import type { ParsedName, SkipReason } from "./types.ts";

const TECHNICAL =
  /\b(?:\d{3,4}x\d{3,4}|480p|576p|720p|1080[pi]|2160p|4k|uhd|bluray|blu-ray|bdrip|brrip|bdremux|remux|web[- ]?dl|webrip|hdtv|dvdrip|hdrip|x26[45]|h ?26[45]|hevc|av1|xvid|divx)\b/i;
// What a release name says about its picture, best first within each kind.
const RESOLUTION = /\b(?:\d{3,4}x(\d{3,4})|(480|576|720|1080|2160)([pi])|(4k|uhd))\b/i;
const SOURCES: [RegExp, string][] = [
  [/\b(?:bd)?remux\b/i, "Remux"],
  [/\b(?:blu-?ray|bdrip|brrip)\b/i, "BluRay"],
  [/\bweb[- .]?dl\b/i, "WEB-DL"],
  [/\bwebrip\b/i, "WEBRip"],
  [/\bhdtv\b/i, "HDTV"],
  [/\bhdrip\b/i, "HDRip"],
  [/\bdvdrip\b/i, "DVDRip"],
];
const CODECS: [RegExp, string][] = [
  [/\bav1\b/i, "AV1"],
  [/\b(?:x265|h[ .]?265|hevc)\b/i, "x265"],
  [/\b(?:x264|h[ .]?264)\b/i, "x264"],
  [/\bxvid\b/i, "XviD"],
  [/\bdivx\b/i, "DivX"],
];

export interface Quality {
  /** Resolution, source and codec, higher is better; 0 where the name does not say. */
  rank: [number, number, number];
  /** The same three as they would be written in a filename. */
  labels: [string | null, string | null, string | null];
}

/** Reads resolution, source and codec from release names; earlier names win over later ones. */
export function readQuality(...names: string[]): Quality {
  const quality: Quality = { rank: [0, 0, 0], labels: [null, null, null] };
  for (const name of names) {
    const resolution = RESOLUTION.exec(name);
    if (resolution && !quality.labels[0]) {
      const height = Number(resolution[1] ?? resolution[2] ?? 2160);
      quality.rank[0] = height;
      quality.labels[0] = `${height}${resolution[3]?.toLowerCase() ?? "p"}`;
    }
    for (const [slot, kinds] of [[1, SOURCES], [2, CODECS]] as const) {
      const found = kinds.findIndex(([pattern]) => pattern.test(name));
      if (found < 0 || quality.labels[slot]) continue;
      quality.rank[slot] = kinds.length - found;
      quality.labels[slot] = kinds[found]![1];
    }
  }
  return quality;
}

// S01E02, S01E02E03, S01E02-E03, S01E02-03 (but not S01E02-720p); also S01 E02, S01-E02, S01Ep02
const SEASON_EPISODE =
  /\bS(\d{1,2})(?: ?- ?| )?E(?:p(?:isode)?)? ?(\d{1,4})((?: ?-? ?E\d{1,4}|-\d{1,4}(?![\dpi]))*)/i;
// A marker inside brackets is still the marker: "[8x12]", "(S08E12)".
const BRACKETED_MARKER =
  /[[(]\s*((?:S\d{1,2}[ ._-]*E(?:p(?:isode)?)?[ ._]*\d|\d{1,2}x\d{2,3}\b)[^\])]*)[\])]/gi;
// "[3.21]": season and episode around a dot, trusted only when bracketed on their own.
const BRACKETED_DOTTED = /[[(]\s*(\d{1,2})\.(\d{2})\s*[\])]/g;
// A pack of several seasons, "Seasons 1-20" or "S01-S30": a show, but no one season.
const SEASON_RANGE =
  /\b(?:Seasons ?\d{1,2} ?(?:-|to|thru|through|&) ?\d{1,2}|Season \d{1,2} (?:to|thru|through) \d{1,2}|S\d{1,2} ?- ?S\d{1,2})\b/i;
// Words a collection adds after the name: "Show Complete Season 5", "Show - The Complete Series".
const PACK_WORDS =
  /(?<=\S)[-\s]+(?:the )?(?:complete|(?:complete|full|entire|all) (?:tv )?(?:series|collection|seasons|box ?set|pack))$/i;
// Season and episode run together behind a zero: "0812" is season 8, episode 12.
const COMPACT = /\b0([1-9])(?!00)(\d{2})\b/;
// 1x02, 1x02-03, 1x02-1x03
const CROSS = /\b(\d{1,2})x(\d{2,3})(?:-(?:\d{1,2}x)?(\d{2,3}))?\b/i;
const SEASON_ONLY = /\b(?:S(\d{1,2})|Season (\d{1,2}))\b/i;
// "E12", "Ep 12", "Episode 12", or the fansub form " - 12" / " - 12v2"
const EPISODE_ONLY =
  /\b(?:E(\d{2,4})|(?:Ep|Episode) *(\d{1,4}))\b|\s-\s(\d{1,4})(?:v\d)?(?=\s|$)/i;
// A day in year-month-day order, as daily shows are named: 2024.03.15, 2024-03-15.
const AIR_DATE =
  /\b((?:19|20)\d{2})[ \-](0[1-9]|1[0-2])[ \-](0[1-9]|[12]\d|3[01])\b/;
// A special by its own number: "Show - OVA 2", "[Group] Show SP1". Read as season 0.
const SPECIAL = /\b(?:SP|Special|OVA|OAD) ?(\d{1,3})\b/i;
// "Special 26" is also a film, so without a fansub tag only a " - " before it marks a special.
const DASHED_SPECIAL = new RegExp(`\\s-\\s${SPECIAL.source}`, "i");
const SEASON_FOLDER =
  /^(?:(?:season|series|staffel|saison)[ ._-]?(\d{1,3})|S(\d{1,2}))$/i;
// Folders Plex treats as extras rather than main features.
const EXTRAS_FOLDERS = new Set([
  "extras",
  "featurettes",
  "behind the scenes",
  "deleted scenes",
  "interviews",
  "scenes",
  "shorts",
  "trailers",
  "other",
]);

// Kept free of node:path so the browser preview can share this module.
const segments = (value: string) => value.split(/[\\/]+/).filter(Boolean);
const firstNumber = (...groups: (string | undefined)[]) => {
  const found = groups.find((group) => group !== undefined);
  return found === undefined ? null : Number(found);
};

/** Comparison form of a title: case, accents and punctuation removed. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const tidy = (text: string) =>
  text
    .replace(/[()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[-\s]+$/, "")
    .replace(/^[-\s]+/, "");

/**
 * How alike two titles are, from 0 to 1. Forgives typos, punctuation, a name cut short
 * and release text left after it; only the same title scores 1.
 */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeTitle(a),
    right = normalizeTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const [short, long] = left.length < right.length ? [left, right] : [right, left];
  // One inside the other on word boundaries; the more of it that is covered, the better.
  if (short.length >= 6 && ` ${long} `.includes(` ${short} `))
    return 0.8 + (0.1 * short.length) / long.length;
  // Otherwise the share of characters an edit would leave alone.
  let row = Array.from({ length: short.length + 1 }, (_, index) => index);
  for (let i = 1; i <= long.length; i++) {
    const next = [i];
    for (let j = 1; j <= short.length; j++)
      next[j] = Math.min(
        row[j]! + 1,
        next[j - 1]! + 1,
        row[j - 1]! + (long[i - 1] === short[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return Math.min(0.89, 1 - row[short.length]! / long.length);
}

function skipReason(stem: string): SkipReason | null {
  if (/(?:^|[ ._-])sample(?:[ ._-]|$)/i.test(stem)) return "sample";
  if (/[ ._-]trailer$/i.test(stem)) return "trailer";
  return null;
}

/** Reads title, year and numbering hints from a file or folder name without its extension. */
export function parseStem(stem: string): ParsedName {
  const opened = stem
    .replace(BRACKETED_DOTTED, " $1x$2 ")
    .replace(BRACKETED_MARKER, " $1 ");
  const releaseGroup = /^\[([^\]]+)\]/.exec(opened)?.[1] ?? null;
  // Bracketed blocks hold release details; parentheses are kept only around a year.
  const text = opened
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?!(?:19|20)\d{2}\))[^)]*\)/g, " ")
    .replace(/[._]/g, " ");

  let season: number | null = null,
    episode: number | null = null,
    episodeEnd: number | null = null,
    airDate: string | null = null,
    markerIndex: number | undefined,
    markerEnd = 0;
  const endOf = (match: RegExpExecArray) => match.index + match[0].length;
  const numbered = SEASON_EPISODE.exec(text) || CROSS.exec(text);
  if (numbered) {
    season = Number(numbered[1]);
    episode = Number(numbered[2]);
    const last = numbered[3]?.match(/\d+/g)?.at(-1);
    if (last && Number(last) > episode) episodeEnd = Number(last);
    markerIndex = numbered.index;
    markerEnd = endOf(numbered);
  } else if (SEASON_RANGE.test(text)) {
    const range = SEASON_RANGE.exec(text)!;
    markerIndex = range.index;
    markerEnd = endOf(range);
  } else if (AIR_DATE.test(text)) {
    const dated = AIR_DATE.exec(text)!;
    airDate = `${dated[1]}-${dated[2]}-${dated[3]}`;
    markerIndex = dated.index;
    markerEnd = endOf(dated);
  } else if ((releaseGroup ? SPECIAL : DASHED_SPECIAL).test(text)) {
    const special = (releaseGroup ? SPECIAL : DASHED_SPECIAL).exec(text)!;
    season = 0;
    episode = Number(special[1]);
    markerIndex = special.index;
    markerEnd = endOf(special);
  } else {
    const seasonOnly = SEASON_ONLY.exec(text);
    const episodeOnly = EPISODE_ONLY.exec(text);
    // Fansub releases pad absolute numbers, so a tagged "0812" stays episode 812.
    const compact = releaseGroup || seasonOnly ? null : COMPACT.exec(text);
    if (seasonOnly) season = firstNumber(seasonOnly[1], seasonOnly[2]);
    if (compact) {
      season = Number(compact[1]);
      episode = Number(compact[2]);
      markerIndex = compact.index;
      markerEnd = endOf(compact);
    } else if (episodeOnly) {
      const dashed = episodeOnly[3];
      // A bare " - 2" is more often a sequel than an episode; fansub releases pad or carry a group tag.
      if (dashed === undefined || dashed.length > 1 || releaseGroup || seasonOnly)
        episode = firstNumber(episodeOnly[1], episodeOnly[2], dashed);
    }
    const indexes = [
      seasonOnly?.index,
      episode === null ? undefined : episodeOnly?.index,
    ].filter((index): index is number => index !== undefined);
    if (!compact && indexes.length) {
      markerIndex = Math.min(...indexes);
      markerEnd = Math.max(
        seasonOnly ? endOf(seasonOnly) : 0,
        episode !== null && episodeOnly ? endOf(episodeOnly) : 0,
      );
    }
  }

  const technical = TECHNICAL.exec(text);
  // A leading technical tag is treated as part of the title; a leading episode marker leaves no title.
  const headEnd = Math.min(
    markerIndex ?? text.length,
    technical?.index || text.length,
  );
  const head = text.slice(0, headEnd);
  // The last plausible year before any release details; a leading number is part of the title.
  const maxYear = new Date().getFullYear() + 1;
  const year = [...head.matchAll(/\b(19\d{2}|20\d{2})\b/g)]
    .filter((match) => match.index > 0 && Number(match[1]) <= maxYear)
    .at(-1);
  const named = tidy(head.slice(0, year?.index ?? head.length));
  const title = markerIndex === undefined ? named : tidy(named.replace(PACK_WORDS, ""));
  // What follows the marker, up to the release details, is usually the episode's name.
  const tail = markerIndex === undefined ? "" : text.slice(markerEnd);
  const episodeTitle =
    tidy(tail.slice(0, TECHNICAL.exec(tail)?.index ?? tail.length)) || null;
  return {
    title,
    year: year ? Number(year[1]) : null,
    kind: markerIndex === undefined ? "movie" : "tv",
    season,
    episode,
    episodeEnd,
    episodeTitle,
    airDate,
    releaseGroup,
    skip: skipReason(stem),
  };
}

export function parseFilename(name: string): ParsedName {
  return parseStem(name.replace(/\.[^.]+$/, ""));
}

/**
 * Parses a file using its folders for what the filename leaves out, e.g.
 * "Show/Season 2/05 - Title.mkv" or a scene folder holding an abbreviated filename.
 * Folders above `root` are never consulted.
 */
export function parseMediaPath(filePath: string, root: string): ParsedName {
  const parts = segments(filePath);
  const depth = parts.length - segments(root).length;
  const name = parts.at(-1) ?? "";
  let parsed = parseFilename(name);
  const parent = parts.at(-2) ?? "";
  const grandparent = depth > 1 ? (parts.at(-3) ?? "") : "";
  if (EXTRAS_FOLDERS.has(parent.toLowerCase())) parsed.skip ??= "extra";
  if (/^samples?$/i.test(parent)) parsed.skip ??= "sample";

  const seasonFolder =
    SEASON_FOLDER.exec(parent) || (/^specials?$/i.test(parent) ? [] : null);
  const showFolder = parseStem(seasonFolder ? grandparent : parent);
  if (seasonFolder) {
    const stem = name.replace(/\.[^.]+$/, "");
    const folderSeason = firstNumber(seasonFolder[1], seasonFolder[2]) ?? 0;
    // "812" or "Show 1203 - Title" in its own season's folder: season and episode run together.
    if (parsed.season === null && folderSeason > 0 && parsed.airDate === null) {
      const joined = new RegExp(
        `(^|[ ._-])0?${folderSeason}(?!00)(\\d{2})(?=[ ._-]|$)`,
      ).exec(stem);
      if (
        parsed.episode !== null &&
        parsed.episodeEnd === null &&
        parsed.episode % 100 &&
        Math.floor(parsed.episode / 100) === folderSeason
      )
        parsed.episode %= 100;
      else if (parsed.episode === null && joined) {
        const skip = parsed.skip;
        parsed = parseStem(
          `${stem.slice(0, joined.index)}${joined[1]}S${folderSeason}E${joined[2]}${stem.slice(joined.index + joined[0].length)}`,
        );
        parsed.skip = skip;
      }
    }
    parsed.kind = "tv";
    parsed.season ??= folderSeason;
    if (parsed.episode === null) {
      // "05 - Title.mkv": only trusted as an episode number inside a season folder.
      const leading = /^(\d{1,3})(?=[ ._-]|$)/.exec(stem);
      if (leading) {
        parsed.episode = Number(leading[1]);
        parsed.episodeTitle = tidy(stem.slice(leading[0].length).replace(/[._]/g, " ")) || null;
        parsed.title = "";
      } else if (parsed.airDate === null && parsed.title && showFolder.title) {
        // No number at all: the name is the episode's, with or without the show's in front.
        const own = normalizeTitle(parsed.title),
          show = normalizeTitle(showFolder.title);
        parsed.episodeTitle = own.startsWith(`${show} `)
          ? own.slice(show.length + 1)
          : parsed.title;
        parsed.title = "";
      }
    }
  }
  if (parsed.kind === "tv") {
    // "Simpsons 5x01" inside "The Simpsons": the folder has the fuller form of the same name.
    showFolder.title = tidy(showFolder.title.replace(PACK_WORDS, ""));
    const own = normalizeTitle(parsed.title).split(" "),
      fuller = normalizeTitle(showFolder.title).split(" ");
    if (
      parsed.title &&
      fuller.length > own.length &&
      own.every((word) => fuller.includes(word))
    ) {
      parsed.title = showFolder.title;
      parsed.year ??= showFolder.year;
    }
    if (!parsed.title) {
      parsed.title = showFolder.title;
      parsed.year ??= showFolder.year;
      parsed.season ??= showFolder.season;
    } else if (
      parsed.season === null &&
      showFolder.season !== null &&
      normalizeTitle(showFolder.title) === normalizeTitle(parsed.title)
    )
      parsed.season = showFolder.season;
  } else if (
    parsed.year === null &&
    showFolder.year !== null &&
    showFolder.title &&
    (TECHNICAL.test(parent) || /\((?:19|20)\d{2}\)/.test(parent))
  ) {
    // Release and movie folders carry the full name while the file inside is often abbreviated.
    parsed.title = showFolder.title;
    parsed.year = showFolder.year;
  }
  return parsed;
}
