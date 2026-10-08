/** Where one Kitsu entry sits in the general catalogues: which show, season, and how far in. */
export interface AnimeMapping {
  tmdbId?: number;
  tmdbSeason?: number;
  /** Episodes of that season that come before this entry's first. */
  tmdbOffset?: number;
  tvdbId?: number;
  tvdbSeason?: number;
  tvdbOffset?: number;
  imdbId?: string;
  /** Set for films, whose TMDB IDs are numbered separately from shows'. */
  film?: true;
  /**
   * Episodes that do not follow the season and offset above, per catalogue. The
   * `…Specials` lists place the entry's own specials, which are numbered separately.
   */
  rules?: {
    tmdb?: EpisodeRule[];
    tvdb?: EpisodeRule[];
    tmdbSpecials?: EpisodeRule[];
    tvdbSpecials?: EpisodeRule[];
  };
}

/**
 * Where some of an entry's episodes really sit. Either a run (`start` to `end`, shifted
 * by `offset`) or single episodes, each listing the catalogue episode or episodes it
 * corresponds to; an empty list means the catalogue has no such episode.
 */
export interface EpisodeRule {
  season: number;
  start?: number;
  end?: number;
  offset?: number;
  episodes?: Record<string, number[]>;
}

/**
 * The catalogue season and episode numbers for one episode of an entry. Null means the
 * catalogue has no such episode; undefined means no rule covers it and no `fallback`
 * was given, so nothing is known.
 */
export function placeEpisode(
  number: number,
  rules: EpisodeRule[] | undefined,
  fallback?: { season: number; offset: number },
): { season: number; numbers: number[] } | null | undefined {
  // A single-episode rule is more specific than a run, so it is consulted first.
  for (const rule of rules ?? []) {
    const numbers = rule.episodes?.[number];
    if (numbers) return numbers.length ? { season: rule.season, numbers } : null;
  }
  for (const rule of rules ?? [])
    if (
      rule.start !== undefined &&
      number >= rule.start &&
      number <= (rule.end ?? Infinity)
    )
      return { season: rule.season, numbers: [number + (rule.offset ?? 0)] };
  return fallback && {
    season: fallback.season,
    numbers: [number + fallback.offset],
  };
}

/** Where the downloaded list is kept between launches. */
export interface MapCache {
  read(): Promise<{ savedAt: number; text: string } | null>;
  write(text: string): Promise<void>;
}

const SOURCE =
  "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
// The same project's upstream, which also records episodes that break the pattern.
const EXCEPTIONS =
  "https://raw.githubusercontent.com/Anime-Lists/anime-lists/master/anime-list-master.xml";
const LIMIT = 40 * 1024 * 1024;
const WEEK = 7 * 24 * 60 * 60 * 1000;

const whole = (value: unknown, max = 100_000_000): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : undefined;
const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

/**
 * Reduces the community list to what this app uses, keyed by Kitsu ID. The list is other
 * people's data and its numbers end up in file names, so every field is checked for type
 * and range and anything else is dropped.
 */
export function buildIndex(
  list: unknown,
  exceptions: Map<number, AnimeMapping["rules"]> = new Map(),
): Record<string, AnimeMapping> {
  const index: Record<string, AnimeMapping> = {};
  if (!Array.isArray(list)) throw new Error("The anime list is not in the expected form.");
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const kitsu = whole(entry.kitsu_id);
    if (kitsu === undefined) continue;
    const tmdb = entry.themoviedb_id ?? {};
    const imdb = first(entry.imdb_id);
    const mapping: AnimeMapping = {
      tmdbId: whole(first(tmdb.tv ?? tmdb.movie)) || undefined,
      tmdbSeason: whole(entry.season?.tmdb, 999),
      tmdbOffset: whole(entry.episode_offset?.tmdb, 9999),
      tvdbId: whole(entry.tvdb_id) || undefined,
      tvdbSeason: whole(entry.season?.tvdb, 999),
      tvdbOffset: whole(entry.episode_offset?.tvdb, 9999),
      imdbId: typeof imdb === "string" && /^tt\d+$/.test(imdb) ? imdb : undefined,
      ...(tmdb.movie !== undefined && tmdb.tv === undefined ? { film: true } : {}),
    };
    // The exceptions are recorded against AniDB's numbering of the same entry.
    const rules = exceptions.get(whole(entry.anidb_id) ?? -1);
    if (rules) mapping.rules = rules;
    if (mapping.tmdbId || mapping.tvdbId || mapping.imdbId) index[kitsu] = mapping;
  }
  return index;
}

/**
 * Reads the per-episode exceptions out of the upstream XML, keyed by AniDB ID: those for
 * an entry's regular episodes, and those placing its own specials. As with the main list,
 * every number is checked and anything unexpected is skipped.
 */
export function parseExceptions(xml: string): Map<number, AnimeMapping["rules"]> {
  const found = new Map<number, AnimeMapping["rules"]>();
  const attribute = (text: string, name: string) =>
    new RegExp(`\\b${name}="(-?\\d+)"`).exec(text)?.[1];
  const number = (text: string | undefined, min: number, max: number) => {
    const value = Number(text);
    return text !== undefined && Number.isInteger(value) && value >= min && value <= max
      ? value
      : undefined;
  };
  for (const [, head = "", body = ""] of xml.matchAll(
    /<anime\s([^>]*)>([\s\S]*?)<\/anime>/g,
  )) {
    const anidb = number(attribute(head, "anidbid"), 1, 100_000_000);
    if (anidb === undefined || !body.includes("<mapping ")) continue;
    const rules: NonNullable<AnimeMapping["rules"]> = {};
    for (const [, attributes = "", text = ""] of body.matchAll(
      /<mapping\s([^>]*?)\s*(?:\/>|>([^<]*)<\/mapping>)/g,
    )) {
      // Season 1 is the entry's regular episodes, season 0 its own specials.
      const own = attribute(attributes, "anidbseason");
      if (own !== "1" && own !== "0") continue;
      const rule: Omit<EpisodeRule, "season"> = {};
      const start = number(attribute(attributes, "start"), 1, 9999);
      if (start !== undefined) {
        rule.start = start;
        rule.end = number(attribute(attributes, "end"), start, 9999);
        rule.offset = number(attribute(attributes, "offset"), -9999, 9999) ?? 0;
        // A shift that would give an episode number below 1 cannot be right.
        if (start + rule.offset < 1) continue;
      }
      // ";9-1;18-2+3;" maps episode 9 to 1 and episode 18 to 2 and 3; "-0" means nowhere.
      for (const [, from, to = ""] of text.matchAll(/(\d+)-([\d+]+)/g)) {
        const numbers = to.split("+").map((part) => number(part, 0, 9999));
        const source = number(from, 1, 9999);
        if (source === undefined || numbers.includes(undefined)) continue;
        (rule.episodes ??= {})[source] = (numbers as number[]).filter(Boolean);
      }
      if (rule.start === undefined && !rule.episodes) continue;
      for (const catalogue of ["tmdb", "tvdb"] as const) {
        const season = number(attribute(attributes, `${catalogue}season`), 0, 999);
        const slot = own === "1" ? catalogue : (`${catalogue}Specials` as const);
        if (season !== undefined) (rules[slot] ??= []).push({ season, ...rule });
      }
    }
    if (Object.keys(rules).length) found.set(anidb, rules);
  }
  return found;
}

/**
 * A community-maintained list that ties anime entries to TMDB and TVDB shows and seasons.
 * It is downloaded the first time it is needed, kept for a week, and reused beyond that if
 * a refresh fails. Without it, lookups simply find nothing.
 */
export class AnimeMap {
  enabled = true;
  private index: Promise<Record<string, AnimeMapping>> | null = null;
  private fetcher: typeof fetch;
  private cache: MapCache | undefined;
  private now: () => number;

  constructor(
    options: { fetcher?: typeof fetch; cache?: MapCache; now?: () => number } = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.cache = options.cache;
    this.now = options.now ?? Date.now;
  }

  async lookup(kitsuId: number): Promise<AnimeMapping | null> {
    if (!this.enabled) return null;
    this.index ??= this.load();
    try {
      return (await this.index)[kitsuId] ?? null;
    } catch {
      // Let a later lookup try again rather than remembering the failure.
      this.index = null;
      return null;
    }
  }

  /**
   * The entry a show starts with: of all entries mapped to the same show in the given
   * catalogue, the one earliest in its first regular season. Null if this entry is not
   * part of a show the list knows.
   */
  async firstEntry(
    kitsuId: number,
    catalogue: "tmdb" | "tvdb",
  ): Promise<number | null> {
    if (!this.enabled) return null;
    this.index ??= this.load();
    const index = await this.index.catch(() => null);
    const mine = index?.[kitsuId];
    const show = mine?.[`${catalogue}Id`];
    if (!index || !mine || mine.film || !show) return null;
    // Earliest season, then earliest in it, then the oldest entry.
    type Place = [season: number, offset: number, id: number];
    const before = (a: Place, b: Place) =>
      (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) < 0;
    let best: Place | null = null;
    for (const [id, other] of Object.entries(index)) {
      const season = other[`${catalogue}Season`];
      if (other.film || other[`${catalogue}Id`] !== show || !season) continue;
      const place: Place = [season, other[`${catalogue}Offset`] ?? 0, Number(id)];
      if (!best || before(place, best)) best = place;
    }
    return best?.[2] ?? null;
  }

  private async load(): Promise<Record<string, AnimeMapping>> {
    const saved = await this.cache?.read().catch(() => null);
    const parse = (text: string) => JSON.parse(text) as Record<string, AnimeMapping>;
    if (saved && this.now() - saved.savedAt < WEEK)
      try {
        return parse(saved.text);
      } catch {
        // An unreadable copy is replaced below.
      }
    const download = async (address: string) => {
      const response = await this.fetcher(address, {
        headers: { "User-Agent": "Organtic/0.1" },
        signal: AbortSignal.timeout(60000),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (Number(response.headers.get("content-length")) > LIMIT)
        throw new Error("The anime list is larger than expected.");
      const body = await response.text();
      if (body.length > LIMIT) throw new Error("The anime list is larger than expected.");
      return body;
    };
    try {
      const [list, exceptions] = await Promise.all([
        download(SOURCE),
        // The exceptions refine the list; without them it is still worth having.
        download(EXCEPTIONS).then(parseExceptions, () => null),
      ]);
      const index = buildIndex(JSON.parse(list), exceptions ?? undefined);
      // Only the reduced index is kept: a fraction of the size, and already checked.
      // An index missing its exceptions is not saved, so the next launch tries again.
      if (exceptions) await this.cache?.write(JSON.stringify(index)).catch(() => {});
      return index;
    } catch (error) {
      if (saved) return parse(saved.text);
      throw error;
    }
  }
}
