import type { ParsedName, SkipReason } from "./types.ts";

const TECHNICAL =
  /\b(?:\d{3,4}x\d{3,4}|480p|576p|720p|1080[pi]|2160p|4k|uhd|bluray|blu-ray|bdrip|brrip|bdremux|remux|web[- ]?dl|webrip|hdtv|dvdrip|hdrip|x26[45]|h ?26[45]|hevc|av1|xvid|divx)\b/i;
// S01E02, S01E02E03, S01E02-E03, S01E02-03 (but not S01E02-720p)
const SEASON_EPISODE =
  /\bS(\d{1,2}) ?E(\d{1,4})((?: ?-? ?E\d{1,4}|-\d{1,4}(?![\dpi]))*)/i;
// 1x02, 1x02-03, 1x02-1x03
const CROSS = /\b(\d{1,2})x(\d{2,3})(?:-(?:\d{1,2}x)?(\d{2,3}))?\b/i;
const SEASON_ONLY = /\b(?:S(\d{1,2})|Season (\d{1,2}))\b/i;
// "E12", "Ep 12", "Episode 12", or the fansub form " - 12" / " - 12v2"
const EPISODE_ONLY =
  /\b(?:E(\d{2,4})|(?:Ep|Episode) ?(\d{1,4}))\b|\s-\s(\d{1,4})(?:v\d)?(?=\s|$)/i;
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

function skipReason(stem: string): SkipReason | null {
  if (/(?:^|[ ._-])sample(?:[ ._-]|$)/i.test(stem)) return "sample";
  if (/[ ._-]trailer$/i.test(stem)) return "trailer";
  return null;
}

/** Reads title, year and numbering hints from a file or folder name without its extension. */
export function parseStem(stem: string): ParsedName {
  const releaseGroup = /^\[([^\]]+)\]/.exec(stem)?.[1] ?? null;
  // Bracketed blocks hold release details; parentheses are kept only around a year.
  const text = stem
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?!(?:19|20)\d{2}\))[^)]*\)/g, " ")
    .replace(/[._]/g, " ");

  let season: number | null = null,
    episode: number | null = null,
    episodeEnd: number | null = null,
    airDate: string | null = null,
    markerIndex: number | undefined;
  const numbered = SEASON_EPISODE.exec(text) || CROSS.exec(text);
  if (numbered) {
    season = Number(numbered[1]);
    episode = Number(numbered[2]);
    const last = numbered[3]?.match(/\d+/g)?.at(-1);
    if (last && Number(last) > episode) episodeEnd = Number(last);
    markerIndex = numbered.index;
  } else if (AIR_DATE.test(text)) {
    const dated = AIR_DATE.exec(text)!;
    airDate = `${dated[1]}-${dated[2]}-${dated[3]}`;
    markerIndex = dated.index;
  } else if ((releaseGroup ? SPECIAL : DASHED_SPECIAL).test(text)) {
    const special = (releaseGroup ? SPECIAL : DASHED_SPECIAL).exec(text)!;
    season = 0;
    episode = Number(special[1]);
    markerIndex = special.index;
  } else {
    const seasonOnly = SEASON_ONLY.exec(text);
    const episodeOnly = EPISODE_ONLY.exec(text);
    if (seasonOnly) season = firstNumber(seasonOnly[1], seasonOnly[2]);
    if (episodeOnly) {
      const dashed = episodeOnly[3];
      // A bare " - 2" is more often a sequel than an episode; fansub releases pad or carry a group tag.
      if (dashed === undefined || dashed.length > 1 || releaseGroup || seasonOnly)
        episode = firstNumber(episodeOnly[1], episodeOnly[2], dashed);
    }
    const indexes = [
      seasonOnly?.index,
      episode === null ? undefined : episodeOnly?.index,
    ].filter((index): index is number => index !== undefined);
    if (indexes.length) markerIndex = Math.min(...indexes);
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
  const title = head
    .slice(0, year?.index ?? head.length)
    .replace(/[()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[-\s]+$/, "")
    .replace(/^[-\s]+/, "");
  return {
    title,
    year: year ? Number(year[1]) : null,
    kind: markerIndex === undefined ? "movie" : "tv",
    season,
    episode,
    episodeEnd,
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
  const parsed = parseFilename(name);
  const parent = parts.at(-2) ?? "";
  const grandparent = depth > 1 ? (parts.at(-3) ?? "") : "";
  if (EXTRAS_FOLDERS.has(parent.toLowerCase())) parsed.skip ??= "extra";
  if (/^samples?$/i.test(parent)) parsed.skip ??= "sample";

  const seasonFolder =
    SEASON_FOLDER.exec(parent) || (/^specials?$/i.test(parent) ? [] : null);
  if (seasonFolder) {
    parsed.kind = "tv";
    parsed.season ??= firstNumber(seasonFolder[1], seasonFolder[2]) ?? 0;
    if (parsed.episode === null) {
      // "05 - Title.mkv": only trusted as an episode number inside a season folder.
      const leading = /^(\d{1,3})(?=[ ._-]|$)/.exec(name.replace(/\.[^.]+$/, ""));
      if (leading) {
        parsed.episode = Number(leading[1]);
        parsed.title = "";
      }
    }
  }
  const showFolder = parseStem(seasonFolder ? grandparent : parent);
  if (parsed.kind === "tv") {
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
