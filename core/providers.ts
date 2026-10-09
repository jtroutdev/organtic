import type {
  Candidate,
  Catalogue,
  Episode,
  EpisodeOrdering,
  EpisodeRequest,
  OrderingChoice,
  Media,
  MediaKind,
  ProviderName,
  ResolveResult,
  SeasonListing,
} from "./types.ts";

import { placeEpisode } from "./animeMap.ts";
import type { AnimeMap, AnimeMapping, EpisodeRule } from "./animeMap.ts";
import { normalizeTitle } from "./parse.ts";

const stripHtml = (value: unknown) =>
  String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
const yearOf = (date?: string | null) =>
  date ? Number(date.slice(0, 4)) || null : null;

type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;
type Params = Record<string, string | number | boolean | null | undefined>;

export interface SearchInput {
  provider: ProviderName;
  kind: MediaKind;
  query: string;
  year?: number | null;
  language?: string;
}

export interface ResolveInput {
  season: number;
  episode: number;
  language?: string;
}

// Only the fields this app reads from each provider's response.
interface TvmazeShow {
  id: number;
  name: string;
  premiered?: string | null;
  summary?: string | null;
  language?: string;
  url?: string;
  externals?: { thetvdb?: number | null; imdb?: string | null };
  image?: { original?: string | null } | null;
}
interface KitsuAnime {
  id: string;
  attributes?: {
    canonicalTitle?: string;
    titles?: Record<string, string | null | undefined>;
    abbreviatedTitles?: string[] | null;
    slug?: string;
    synopsis?: string | null;
    startDate?: string | null;
    subtype?: string;
    posterImage?: { original?: string | null } | null;
    coverImage?: { original?: string | null } | null;
  };
  relationships?: { mappings?: { data?: { id: string }[] } };
}
interface KitsuMapping {
  id: string;
  attributes?: { externalSite?: string; externalId?: string };
}
interface KitsuEpisode {
  attributes?: {
    number?: number | null;
    canonicalTitle?: string | null;
    titles?: Record<string, string | null | undefined>;
    synopsis?: string | null;
    airdate?: string | null;
  };
}
interface TvdbEpisode {
  id?: number;
  name?: string | null;
  seasonNumber?: number;
  number?: number;
  aired?: string | null;
  overview?: string | null;
}
interface TvmazeImage {
  type?: string | null;
  main?: boolean;
  resolutions?: { original?: { url?: string } };
}
// TMDB returns a path such as "/abc123.jpg"; anything else is not used.
const tmdbImage = (value?: string | null) =>
  value && /^\/[\w.-]+$/.test(value)
    ? `https://image.tmdb.org/t/p/original${value}`
    : undefined;
interface TmdbSearchItem {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  original_language?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
}
interface EpisodeData {
  id?: number;
  name?: string;
  season?: number;
  number?: number | null;
  episode_number?: number;
  summary?: string | null;
  overview?: string;
  airdate?: string;
  air_date?: string;
  season_number?: number;
}

export class Providers {
  private fetcher: Fetcher;
  private sleep: (ms: number) => Promise<unknown>;
  private cache = new Map<string, { at: number; data: unknown }>();
  private token = "";
  private controller = new AbortController();
  private animeMap: AnimeMap | undefined;

  constructor({
    fetcher = fetch as Fetcher,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    animeMap,
  }: {
    fetcher?: Fetcher;
    sleep?: (ms: number) => Promise<unknown>;
    /** Ties Kitsu entries to TMDB and TVDB seasons; without it Kitsu's own mapping is used. */
    animeMap?: AnimeMap;
  } = {}) {
    this.fetcher = fetcher;
    this.sleep = sleep;
    this.animeMap = animeMap;
  }
  setToken(token: unknown) {
    if (typeof token !== "string" || token.length > 4096)
      throw new Error("Invalid TMDB token.");
    this.token = token.trim();
    this.cache.clear();
  }
  /** Abandons every request in flight; their callers see a connection error. */
  cancel() {
    this.controller.abort();
    this.controller = new AbortController();
  }
  get hasToken() {
    return this.token !== "";
  }

  // ---- TVDB: used only for details of episodes already numbered as TVDB lists them ----

  private tvdbKey = "";
  private tvdbPin = "";
  private tvdbSession: Promise<string> | null = null;
  /** A TVDB v4 API key, with the subscriber PIN some keys need. Empty removes it. */
  setTvdbKey(key: unknown, pin: unknown = "") {
    if (
      typeof key !== "string" ||
      typeof pin !== "string" ||
      key.length > 200 ||
      pin.length > 200
    )
      throw new Error("Invalid TVDB key.");
    this.tvdbKey = key.trim();
    this.tvdbPin = this.tvdbKey ? pin.trim() : "";
    this.tvdbSession = null;
  }
  get hasTvdbKey() {
    return this.tvdbKey !== "";
  }
  /** Signs in with the key, which is how a wrong one is found out. */
  async checkTvdbKey(): Promise<void> {
    await this.tvdbSignIn();
  }
  private tvdbSignIn(): Promise<string> {
    if (!this.tvdbKey) return Promise.reject(new Error("No TVDB key is set."));
    this.tvdbSession ??= (async () => {
      let response: Response;
      try {
        response = await this.fetcher(new URL("https://api4.thetvdb.com/v4/login"), {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Organtic/0.1",
          },
          body: JSON.stringify({
            apikey: this.tvdbKey,
            ...(this.tvdbPin ? { pin: this.tvdbPin } : {}),
          }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
      } catch {
        throw new Error("Could not reach TVDB. Check your connection and try again.");
      }
      const data = (await response.json().catch(() => null)) as {
        data?: { token?: unknown };
      } | null;
      const token = data?.data?.token;
      if (!response.ok || typeof token !== "string" || !token)
        throw new Error(
          response.status === 401
            ? "TVDB rejected that key. Check the key and, if it needs one, the PIN."
            : `TVDB returned HTTP ${response.status} when signing in.`,
        );
      return token;
    })();
    // A failed sign-in is not remembered, so a corrected key or a retry can work.
    this.tvdbSession.catch(() => (this.tvdbSession = null));
    return this.tvdbSession;
  }
  /**
   * TVDB's own record of the given episodes of a match numbered as TVDB lists it. Empty
   * unless a key is set and every episode is listed with a name in the wanted language.
   */
  private async tvdbEpisodes(
    candidate: Candidate,
    season: number,
    numbers: number[],
    language: string,
  ): Promise<Episode[]> {
    // A TMDB ID on the match means its numbers are TMDB's, which TVDB cannot title.
    if (!candidate.tvdbId || candidate.tmdbId || !this.tvdbKey) return [];
    const code =
      { en: "eng", de: "deu", es: "spa", fr: "fra", it: "ita", pt: "por", ja: "jpn", ko: "kor", zh: "zho" }[
        language.slice(0, 2)
      ] ?? "eng";
    try {
      const url = new URL(
        `https://api4.thetvdb.com/v4/series/${candidate.tvdbId}/episodes/default/${code}`,
      );
      url.searchParams.set("season", String(season));
      url.searchParams.set("page", "0");
      let listed = this.cache.get(url.href)?.data as TvdbEpisode[] | undefined;
      if (!listed) {
        const response = await this.fetcher(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Organtic/0.1",
            Authorization: `Bearer ${await this.tvdbSignIn()}`,
          },
          signal: AbortSignal.any([
            AbortSignal.timeout(15000),
            this.controller.signal,
          ]),
          redirect: "error",
        });
        // An expired sign-in is renewed the next time it is needed.
        if (response.status === 401) this.tvdbSession = null;
        if (!response.ok) return [];
        const data = (await response.json()) as {
          data?: { episodes?: TvdbEpisode[] };
        };
        listed = Array.isArray(data.data?.episodes) ? data.data.episodes : [];
        this.cache.set(url.href, { at: Date.now(), data: listed });
      }
      const found = numbers.map((number) => {
        const item = listed.find(
          (episode) => episode.seasonNumber === season && episode.number === number,
        );
        return item?.id && item.name
          ? {
              season,
              number,
              title: item.name,
              id: item.id,
              aired: item.aired ?? undefined,
              overview: item.overview ?? "",
            }
          : undefined;
      });
      return found.every((item) => item !== undefined) ? found : [];
    } catch {
      return [];
    }
  }
  async request<T>(
    provider: ProviderName,
    route: string,
    params: Params = {},
  ): Promise<T> {
    if (!["tmdb", "tvmaze", "kitsu"].includes(provider))
      throw new Error("Unknown provider.");
    if (provider === "tmdb" && !this.token)
      throw new Error("Add a TMDB API read access token in Sources first.");
    const base = {
      tmdb: "https://api.themoviedb.org/3/",
      tvmaze: "https://api.tvmaze.com/",
      kitsu: "https://kitsu.io/api/edge/",
    }[provider];
    const url = new URL(route, base);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "")
        url.searchParams.set(k, String(v));
    });
    const key = url.href;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 3600000)
      return structuredClone(cached.data) as T;
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: {
            // Kitsu refuses anything but the JSON:API media type.
            Accept:
              provider === "kitsu"
                ? "application/vnd.api+json"
                : "application/json",
            "User-Agent": "Organtic/0.1",
            ...(provider === "tmdb"
              ? { Authorization: `Bearer ${this.token}` }
              : {}),
          },
          signal: AbortSignal.any([
            AbortSignal.timeout(15000),
            this.controller.signal,
          ]),
          redirect: "error",
        });
      } catch {
        throw new Error(
          "Could not reach the metadata source. Check your connection and try again.",
        );
      }
      if (response.status === 429 && attempt < 2) {
        await response.body?.cancel();
        const seconds = Number(response.headers.get("retry-after"));
        await this.sleep(
          Math.min(
            10000,
            Math.max(1000, Number.isFinite(seconds) ? seconds * 1000 : 2000),
          ),
        );
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          response.status === 401
            ? "The TMDB token was rejected."
            : response.status === 404
              ? "This episode was not found. Check its season and episode numbers."
              : response.status === 429
                ? "The source is busy. Wait a moment and try again."
                : `Metadata source returned HTTP ${response.status}. Try again later.`,
        );
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new Error("The source returned invalid data.");
      }
      if (!data || typeof data !== "object")
        throw new Error("The source returned invalid data.");
      if (this.cache.size >= 500) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(key, { at: Date.now(), data });
      return structuredClone(data) as T;
    }
    throw new Error("The source is busy. Wait a moment and try again.");
  }
  async search({
    provider,
    kind,
    query,
    year,
    language = "en-US",
  }: SearchInput): Promise<Candidate[]> {
    if (
      !["movie", "tv"].includes(kind) ||
      typeof query !== "string" ||
      !query.trim() ||
      query.length > 200
    )
      throw new Error("Enter a title to search.");
    if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language))
      throw new Error("Use a language such as en-US or fr-FR.");
    if (provider === "kitsu")
      return (await this.kitsuSearch(kind, query)).map((entry) =>
        this.kitsuCandidate(entry, kind, language),
      );
    if (provider === "tvmaze") {
      if (kind !== "tv")
        throw new Error("TVmaze supports TV shows. Choose TMDB for movies.");
      const data = await this.request<{ show: TvmazeShow }[]>(
        provider,
        "search/shows",
        { q: query },
      );
      if (!Array.isArray(data))
        throw new Error("TVmaze returned an unexpected response.");
      return data.slice(0, 12).map(({ show }) => ({
        provider,
        kind,
        id: show.id,
        title: show.name,
        year: yearOf(show.premiered),
        overview: stripHtml(show.summary),
        language: show.language,
        sourceUrl: show.url,
        tvdbId: show.externals?.thetvdb ?? undefined,
        imdbId: show.externals?.imdb ?? undefined,
        posterUrl: show.image?.original ?? undefined,
      }));
    }
    const data = await this.request<{ results?: TmdbSearchItem[] }>(
      provider,
      `search/${kind}`,
      {
        query,
        language,
        ...(kind === "movie" ? { year } : { first_air_date_year: year }),
        include_adult: false,
      },
    );
    if (!Array.isArray(data.results))
      throw new Error("TMDB returned an unexpected response.");
    return data.results.slice(0, 12).map((item) => ({
      provider,
      kind,
      id: item.id,
      title: item.title || item.name || "",
      year: yearOf(item.release_date || item.first_air_date),
      overview: item.overview || "",
      language: item.original_language,
      sourceUrl: `https://www.themoviedb.org/${kind}/${item.id}`,
      posterUrl: tmdbImage(item.poster_path),
      backdropUrl: tmdbImage(item.backdrop_path),
    }));
  }
  /**
   * Searches every source that can answer: TMDB when a token is set, TVmaze for shows,
   * and Kitsu for anime. Results keep that order. A source that fails is reported, not fatal.
   */
  async searchAll({
    anime = false,
    ...input
  }: Omit<SearchInput, "provider"> & { anime?: boolean }): Promise<{
    found: Candidate[];
    failed: { provider: ProviderName; message: string }[];
  }> {
    const sources: ProviderName[] = [
      ...(this.token ? (["tmdb"] as const) : []),
      ...(input.kind === "tv" ? (["tvmaze"] as const) : []),
      ...(anime ? (["kitsu"] as const) : []),
    ];
    const settled = await Promise.allSettled(
      sources.map(async (provider) => {
        const found = await this.search({ ...input, provider });
        // A year read from the filename can be off or wrong; don't let it hide every result.
        return found.length || input.year == null
          ? found
          : this.search({ ...input, provider, year: null });
      }),
    );
    return {
      found: settled.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
      failed: settled.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              {
                provider: sources[index]!,
                message:
                  result.reason instanceof Error
                    ? result.reason.message
                    : String(result.reason),
              },
            ]
          : [],
      ),
    };
  }
  async resolve(
    candidate: Candidate,
    { season, episode, language = "en-US" }: ResolveInput,
  ): Promise<Media> {
    if (candidate.kind === "movie") return candidate;
    if (
      !Number.isInteger(season) ||
      season < 0 ||
      season > 999 ||
      !Number.isInteger(episode) ||
      episode < 1 ||
      episode > 9999
    )
      throw new Error("Enter a valid season and episode number.");
    const data =
      candidate.provider === "tvmaze"
        ? await this.request<EpisodeData>(
            "tvmaze",
            `shows/${candidate.id}/episodebynumber`,
            { season, number: episode },
          )
        : await this.request<EpisodeData>(
            "tmdb",
            `tv/${candidate.id}/season/${season}/episode/${episode}`,
            { language },
          );
    if (!data.name || !data.id)
      throw new Error("The source returned incomplete episode details.");
    return {
      ...candidate,
      season,
      episode,
      episodeTitle: data.name,
      episodeId: data.id,
      overview: stripHtml(data.summary || data.overview),
      aired: data.airdate || data.air_date,
    };
  }
  /** Every numbered episode of one season, or of all seasons where the provider returns them together. */
  private async seasonEpisodes(
    candidate: Candidate,
    season: number,
    language: string,
  ): Promise<SeasonListing> {
    const normalize = (item: EpisodeData, itemSeason: number): Episode[] => {
      const number = item.number ?? item.episode_number;
      return item.id && item.name && number
        ? [
            {
              season: itemSeason,
              number,
              title: item.name,
              id: item.id,
              aired: item.airdate || item.air_date,
              overview: stripHtml(item.summary || item.overview),
            },
          ]
        : [];
    };
    if (candidate.provider === "tvmaze") {
      const data = await this.request<EpisodeData[]>(
        "tvmaze",
        `shows/${candidate.id}/episodes`,
        { specials: 1 },
      );
      if (!Array.isArray(data))
        throw new Error("TVmaze returned an unexpected response.");
      return {
        episodes: data
          .filter((item) => item.season === season)
          .flatMap((item) => normalize(item, season)),
      };
    }
    const data = await this.request<{
      episodes?: EpisodeData[];
      poster_path?: string | null;
    }>(
      "tmdb",
      `tv/${candidate.id}/season/${season}`,
      { language },
    );
    if (!Array.isArray(data.episodes))
      throw new Error("TMDB returned an unexpected response.");
    return {
      episodes: data.episodes.flatMap((item) => normalize(item, season)),
      posterUrl: tmdbImage(data.poster_path),
    };
  }
  // ---- Kitsu: an anime catalogue, where each season or part is usually its own entry ----

  private async kitsuSearch(kind: MediaKind, query: string) {
    const data = await this.request<{
      data?: KitsuAnime[];
      included?: KitsuMapping[];
    }>("kitsu", "anime", {
      "filter[text]": query,
      "page[limit]": 12,
      include: "mappings",
      ...(kind === "movie" ? { "filter[subtype]": "movie" } : {}),
    });
    if (!Array.isArray(data.data))
      throw new Error("Kitsu returned an unexpected response.");
    const mappings = new Map(
      (data.included ?? []).map((item) => [item.id, item.attributes]),
    );
    return data.data
      .filter(
        (item) => (item.attributes?.subtype === "movie") === (kind === "movie"),
      )
      .map((item) => ({
        item,
        // "267440/2" is TVDB series 267440, season 2.
        tvdb: (item.relationships?.mappings?.data ?? [])
          .map((link) => mappings.get(link.id))
          .find((mapping) => mapping?.externalSite === "thetvdb")?.externalId,
      }));
  }
  private kitsuTitles(item: KitsuAnime): string[] {
    const { titles = {}, canonicalTitle, abbreviatedTitles } = item.attributes ?? {};
    return [
      titles.en,
      titles.en_us,
      canonicalTitle,
      titles.en_jp,
      ...(abbreviatedTitles ?? []),
      titles.ja_jp,
    ].filter((title): title is string => !!title);
  }
  private kitsuCandidate(
    { item, tvdb }: { item: KitsuAnime; tvdb?: string },
    kind: MediaKind,
    language: string,
  ): Candidate {
    const attributes = item.attributes ?? {};
    const [series, season] = /^(\d+)(?:\/(\d+))?$/.exec(tvdb ?? "")?.slice(1) ?? [];
    const image = (value?: { original?: string | null } | null) =>
      value?.original?.startsWith("https://") ? value.original : undefined;
    return {
      provider: "kitsu",
      kind,
      id: Number(item.id),
      // Japanese titles for Japanese, otherwise the English title where Kitsu has one.
      title:
        (language.startsWith("ja") && attributes.titles?.ja_jp) ||
        this.kitsuTitles(item)[0] ||
        "",
      year: yearOf(attributes.startDate),
      overview: attributes.synopsis ?? "",
      sourceUrl: attributes.slug
        ? `https://kitsu.app/anime/${attributes.slug}`
        : undefined,
      posterUrl: image(attributes.posterImage),
      backdropUrl: image(attributes.coverImage),
      tvdbId: series ? Number(series) : undefined,
      tvdbSeason: season ? Number(season) : undefined,
    };
  }
  /**
   * The other titles an anime goes by, English first, when Kitsu has an entry whose title
   * is exactly `query`. Lets a release named in romaji be found in a general catalogue.
   */
  async alternativeTitles(kind: MediaKind, query: string): Promise<string[]> {
    const same = (a: string, b: string) => normalizeTitle(a) === normalizeTitle(b);
    for (const { item } of await this.kitsuSearch(kind, query)) {
      const titles = this.kitsuTitles(item);
      if (titles.some((title) => same(title, query)))
        return [...new Set(titles)].filter((title) => !same(title, query));
    }
    return [];
  }
  /**
   * Where a Kitsu entry belongs in the general catalogues. TMDB is preferred, as the ID tag
   * is; then TVDB from the community list; then the TVDB season Kitsu itself records.
   */
  private async placeKitsu(
    candidate: Candidate,
    language: string,
    prefer: Catalogue,
  ): Promise<{
    candidate: Candidate;
    season?: number;
    offset: number;
    rules?: EpisodeRule[];
    specials?: EpisodeRule[];
    /** The community list knows this entry, so its numbering there is authoritative. */
    mapped?: true;
  }> {
    const found: AnimeMapping =
      (await this.animeMap?.lookup(candidate.id).catch(() => null)) ?? {};
    const placed = {
      ...candidate,
      tmdbId: found.tmdbId,
      tvdbId: found.tvdbId ?? candidate.tvdbId,
      imdbId: found.imdbId ?? candidate.imdbId,
    };
    // A long-running show may have no single season, only rules saying which run is which.
    const tmdb = async () =>
      found.tmdbId && (found.tmdbSeason !== undefined || found.rules?.tmdb)
        ? {
            candidate: await this.underShow(placed, "tmdb", language),
            season: found.tmdbSeason,
            offset: found.tmdbOffset ?? 0,
            rules: found.rules?.tmdb,
            specials: found.rules?.tmdbSpecials,
            mapped: true as const,
          }
        : null;
    const tvdb = async () =>
      found.tvdbId && (found.tvdbSeason !== undefined || found.rules?.tvdb)
        ? {
            // The numbers are TVDB's, so the tag must be too.
            candidate: await this.underShow(
              { ...placed, tmdbId: undefined },
              "tvdb",
              language,
            ),
            season: found.tvdbSeason,
            offset: found.tvdbOffset ?? 0,
            rules: found.rules?.tvdb,
            specials: found.rules?.tvdbSpecials,
            mapped: true as const,
          }
        : null;
    // The preferred catalogue's numbering where the list has it, else the other's.
    const mapped =
      prefer === "tvdb"
        ? ((await tvdb()) ?? (await tmdb()))
        : ((await tmdb()) ?? (await tvdb()));
    if (mapped) return mapped;
    return {
      candidate: { ...placed, tmdbId: undefined },
      season: candidate.tvdbSeason,
      offset: 0,
    };
  }
  /**
   * Names a later season or part after the show it belongs to, so every entry of one show
   * shares a folder. The show's name, year and artwork come from its first entry; this
   * entry's own poster becomes the season's.
   */
  private async underShow(
    entry: Candidate,
    catalogue: "tmdb" | "tvdb",
    language: string,
  ): Promise<Media> {
    try {
      const first = await this.animeMap?.firstEntry(entry.id, catalogue);
      if (!first || first === entry.id) return entry;
      const data = await this.request<{ data?: KitsuAnime }>(
        "kitsu",
        `anime/${first}`,
      );
      if (!data.data?.attributes) return entry;
      const show = this.kitsuCandidate({ item: data.data }, "tv", language);
      if (!show.title) return entry;
      return {
        ...entry,
        title: show.title,
        year: show.year,
        posterUrl: show.posterUrl,
        backdropUrl: show.backdropUrl,
        seasonPosterUrl: entry.posterUrl,
      };
    } catch {
      // Without the show's own entry, this one keeps its name.
      return entry;
    }
  }
  /**
   * TMDB's own record of the given episodes of a Kitsu match, for details Kitsu lacks.
   * Empty unless the match is numbered by TMDB, a token is set, and every episode is
   * found: a title is only worth having if it is certainly the right one.
   */
  private async tmdbEpisodes(
    candidate: Candidate,
    season: number,
    numbers: number[],
    language: string,
  ): Promise<Episode[]> {
    if (!candidate.tmdbId || !this.token) return [];
    try {
      const { episodes } = await this.seasonEpisodes(
        { ...candidate, provider: "tmdb", id: candidate.tmdbId },
        season,
        language,
      );
      const found = numbers.map((number) =>
        episodes.find((item) => item.number === number),
      );
      return found.every((item) => item !== undefined) ? found : [];
    } catch {
      return [];
    }
  }
  /** A Kitsu entry numbers its own episodes from 1, whatever season the files claim. */
  private async resolveKitsu(
    entry: Candidate,
    requests: EpisodeRequest[],
    language: string,
    prefer: Catalogue,
  ): Promise<ResolveResult[]> {
    const {
      candidate,
      season: placedSeason,
      offset,
      rules,
      specials,
      mapped,
    } = await this.placeKitsu(entry, language, prefer);
    const PAGE = 20;
    const pages = new Map<number, Promise<KitsuEpisode[]>>();
    const page = (number: number) => {
      const offset = Math.floor((number - 1) / PAGE) * PAGE;
      let loaded = pages.get(offset);
      if (!loaded)
        pages.set(
          offset,
          (loaded = this.request<{ data?: KitsuEpisode[] }>(
            "kitsu",
            `anime/${candidate.id}/episodes`,
            { "page[limit]": PAGE, "page[offset]": offset, sort: "number" },
          ).then((data) => data.data ?? [])),
        );
      return loaded;
    };
    const results: ResolveResult[] = [];
    for (const request of requests) {
      try {
        if (request.airDate)
          throw new Error(
            "Kitsu cannot look an episode up by date. Set the season and episode for this file.",
          );
        const { episode } = request;
        const last = request.episodeEnd ?? episode;
        if (!Number.isInteger(episode) || episode < 1 || last < episode || last - episode > 20)
          throw new Error("Enter a valid season and episode number.");
        // A file marked as a special of a regular entry is one of the entry's own specials,
        // which Kitsu does not list. The mapping says where the catalogue keeps each one;
        // where it is silent the file is reported, never numbered as a regular episode.
        if (request.season === 0 && mapped && placedSeason !== 0) {
          const numbers: number[] = [];
          let season: number | undefined;
          for (let number = episode; number <= last; number++) {
            const place = placeEpisode(number, specials);
            if (place === undefined)
              throw new Error(
                `The mapping does not say where special ${number} of this entry belongs. Leave this file out, or match it on another source.`,
              );
            if (place === null)
              throw new Error(
                `Special ${number} of this entry has no counterpart in the catalogue. Leave this file out.`,
              );
            if (season !== undefined && place.season !== season)
              throw new Error(
                "These specials are in different seasons of the catalogue, so one file cannot be named for them.",
              );
            season = place.season;
            numbers.push(...place.numbers);
          }
          if (numbers.some((value, index) => value !== numbers[0]! + index))
            throw new Error(
              "These specials are not next to each other in the catalogue, so one file cannot be named for them.",
            );
          // Kitsu has no titles for an entry's specials; TMDB does, when the numbers are its own.
          // TVDB does for its own numbering, when a key for it is set.
          let listed = await this.tmdbEpisodes(candidate, season!, numbers, language);
          if (!listed.length)
            listed = await this.tvdbEpisodes(candidate, season!, numbers, language);
          results.push({
            media: {
              ...candidate,
              season: season!,
              episode: numbers[0]!,
              ...(numbers.length > 1 ? { episodeEnd: numbers.at(-1)! } : {}),
              episodeTitle: listed.map((item) => item.title).join(" & "),
              ...(listed[0]
                ? { overview: listed[0].overview, aired: listed[0].aired }
                : {}),
            },
          });
          continue;
        }
        const found: NonNullable<KitsuEpisode["attributes"]>[] = [];
        for (let number = episode; number <= last; number++) {
          const match = (await page(number)).find(
            (item) => item.attributes?.number === number,
          )?.attributes;
          if (!match)
            throw new Error(`Episode ${number} was not found for this entry.`);
          found.push(match);
        }
        const first = found[0]!;
        // The mapped season and position in it, else what the file said, else season 1.
        // Some episodes are exceptions to that: moved to another season, or to specials.
        const fallback = { season: placedSeason ?? request.season ?? 1, offset };
        const places = [];
        for (let number = episode; number <= last; number++) {
          const place = placeEpisode(number, rules, fallback);
          if (!place)
            throw new Error(
              `Episode ${number} of this entry has no counterpart in the catalogue. Set the season and episode for this file, or leave it out.`,
            );
          places.push(place);
        }
        const season = places[0]!.season;
        const numbers = places.flatMap((place) => place.numbers);
        if (
          places.some((place) => place.season !== season) ||
          numbers.some((value, index) => value !== numbers[0]! + index)
        )
          throw new Error(
            "These episodes are not next to each other in the catalogue, so one file cannot be named for them.",
          );
        results.push({
          media: {
            ...candidate,
            season,
            episode: numbers[0]!,
            ...(numbers.length > 1 ? { episodeEnd: numbers.at(-1)! } : {}),
            episodeTitle: found
              .map(
                (item) =>
                  item.titles?.en_us || item.canonicalTitle || item.titles?.en_jp || "",
              )
              .filter(Boolean)
              .join(" & "),
            overview: first.synopsis || candidate.overview,
            aired: first.airdate ?? undefined,
          },
        });
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /** The episodes that aired on one day, for files named by date instead of by number. */
  private async airedOn(
    candidate: Candidate,
    date: string,
    language: string,
  ): Promise<Episode[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Unknown date.");
    if (candidate.provider === "tvmaze") {
      const data = await this.request<EpisodeData[]>(
        "tvmaze",
        `shows/${candidate.id}/episodes`,
        { specials: 1 },
      );
      if (!Array.isArray(data))
        throw new Error("TVmaze returned an unexpected response.");
      return data.flatMap((item) =>
        item.airdate === date && item.id && item.name && item.season && item.number
          ? [
              {
                season: item.season,
                number: item.number,
                title: item.name,
                id: item.id,
                aired: item.airdate,
                overview: stripHtml(item.summary),
              },
            ]
          : [],
      );
    }
    // TMDB has no lookup by date: find the season running on that day and search it.
    const show = await this.request<{
      seasons?: { season_number?: number; air_date?: string | null }[];
    }>("tmdb", `tv/${candidate.id}`);
    if (!Array.isArray(show.seasons))
      throw new Error("TMDB returned an unexpected response.");
    const started = show.seasons
      .filter(
        (item) =>
          item.season_number && item.air_date && item.air_date <= date,
      )
      .sort((a, b) => b.air_date!.localeCompare(a.air_date!));
    // The latest season to have started, then the one before in case its dates overlap.
    for (const item of started.slice(0, 2)) {
      const { episodes } = await this.seasonEpisodes(
        candidate,
        item.season_number!,
        language,
      );
      const found = episodes.filter((episode) => episode.aired === date);
      if (found.length) return found;
    }
    return [];
  }
  /** Episode counts of the regular seasons in order, for converting absolute numbers. */
  private async seasonCounts(candidate: Candidate): Promise<[number, number][]> {
    const counts = new Map<number, number>();
    if (candidate.provider === "tvmaze") {
      const data = await this.request<EpisodeData[]>(
        "tvmaze",
        `shows/${candidate.id}/episodes`,
        { specials: 1 },
      );
      if (!Array.isArray(data))
        throw new Error("TVmaze returned an unexpected response.");
      for (const item of data)
        if (item.season && item.number)
          counts.set(
            item.season,
            Math.max(counts.get(item.season) ?? 0, item.number),
          );
    } else {
      const data = await this.request<{
        seasons?: { season_number?: number; episode_count?: number }[];
      }>("tmdb", `tv/${candidate.id}`);
      if (!Array.isArray(data.seasons))
        throw new Error("TMDB returned an unexpected response.");
      for (const item of data.seasons)
        if (item.season_number && item.episode_count)
          counts.set(item.season_number, item.episode_count);
    }
    return [...counts].sort(([a], [b]) => a - b);
  }
  /**
   * Other orders a show's episodes are listed in: TMDB's episode groups (DVD, absolute,
   * story arc and so on) or TVmaze's alternate lists. Empty when the show has none.
   */
  async orderings(candidate: Candidate): Promise<EpisodeOrdering[]> {
    if (candidate.kind !== "tv" || candidate.provider === "kitsu") return [];
    if (candidate.provider === "tvmaze") {
      const lists = await this.request<
        {
          id?: number;
          dvd_release?: boolean;
          verbatim_order?: boolean;
          country_premiere?: boolean;
          streaming_premiere?: boolean;
          broadcast_premiere?: boolean;
          language_premiere?: boolean;
          language?: string | null;
          network?: { name?: string } | null;
          webChannel?: { name?: string } | null;
        }[]
      >("tvmaze", `shows/${candidate.id}/alternatelists`);
      if (!Array.isArray(lists)) return [];
      return lists.flatMap((item) => {
        if (!Number.isInteger(item.id)) return [];
        const kind = item.dvd_release
          ? "DVD order"
          : item.verbatim_order
            ? "Verbatim order"
            : item.streaming_premiere
              ? "Streaming order"
              : item.broadcast_premiere
                ? "Broadcast order"
                : item.country_premiere
                  ? "Country premiere order"
                  : item.language_premiere
                    ? "Language premiere order"
                    : "Alternate order";
        const where = item.network?.name || item.webChannel?.name || item.language;
        return [{ id: String(item.id), name: where ? `${kind} (${where})` : kind }];
      });
    }
    const TYPES: Record<number, string> = {
      1: "original air date",
      2: "absolute",
      3: "DVD",
      4: "digital",
      5: "story arc",
      6: "production",
      7: "TV",
    };
    const data = await this.request<{
      results?: { id?: string; name?: string; type?: number }[];
    }>("tmdb", `tv/${candidate.id}/episode_groups`);
    return (Array.isArray(data.results) ? data.results : []).flatMap((item) =>
      typeof item.id === "string" && /^[0-9a-f]{8,40}$/i.test(item.id)
        ? [
            {
              id: item.id,
              name: [item.name || "Episode group", TYPES[item.type ?? 0]]
                .filter(Boolean)
                .join(" · "),
            },
          ]
        : [],
    );
  }
  /**
   * One ordering as season → position → the aired episode(s) at that position. Position 0
   * is that season's first episode in the ordering; a position can hold more than one
   * aired episode where a release combined them.
   */
  private async ordered(
    candidate: Candidate,
    orderingId: string,
    language: string,
  ): Promise<Map<number, Episode[][]>> {
    const seasons = new Map<number, Episode[][]>();
    const episode = (item: EpisodeData): Episode[] => {
      const season = item.season ?? item.season_number;
      const number = item.number ?? item.episode_number;
      return item.id && item.name && Number.isInteger(season) && number
        ? [
            {
              season: season!,
              number,
              title: item.name,
              id: item.id,
              aired: item.airdate || item.air_date,
              overview: stripHtml(item.summary || item.overview),
            },
          ]
        : [];
    };
    if (candidate.provider === "tvmaze") {
      if (!/^\d+$/.test(orderingId)) throw new Error("Unknown episode order.");
      const data = await this.request<
        {
          season?: number;
          number?: number | null;
          _embedded?: { episodes?: EpisodeData[] };
        }[]
      >("tvmaze", `alternatelists/${orderingId}/alternateepisodes`, {
        embed: "episodes",
      });
      if (!Array.isArray(data))
        throw new Error("TVmaze returned an unexpected response.");
      for (const item of data) {
        if (!Number.isInteger(item.season) || !item.number) continue;
        const slots = seasons.get(item.season!) ?? [];
        slots[item.number - 1] = (item._embedded?.episodes ?? []).flatMap(episode);
        seasons.set(item.season!, slots);
      }
      return seasons;
    }
    if (!/^[0-9a-f]{8,40}$/i.test(orderingId))
      throw new Error("Unknown episode order.");
    const data = await this.request<{
      groups?: { order?: number; episodes?: (EpisodeData & { order?: number })[] }[];
    }>("tmdb", `tv/episode_group/${orderingId}`, { language });
    if (!Array.isArray(data.groups))
      throw new Error("TMDB returned an unexpected response.");
    for (const group of data.groups) {
      if (!Number.isInteger(group.order)) continue;
      seasons.set(
        group.order!,
        [...(group.episodes ?? [])]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map(episode),
      );
    }
    return seasons;
  }
  /** `resolveMany` for files numbered in an alternate ordering. */
  private async resolveOrdered(
    candidate: Candidate,
    requests: EpisodeRequest[],
    language: string,
    ordering: OrderingChoice,
  ): Promise<ResolveResult[]> {
    let seasons: Map<number, Episode[][]>;
    try {
      seasons = await this.ordered(candidate, ordering.id, language);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return requests.map(() => ({ error: message }));
    }
    const regular = [...seasons].filter(([n]) => n > 0).sort(([a], [b]) => a - b);
    return requests.map((request): ResolveResult => {
      if (request.airDate)
        return {
          error:
            "A file named by date can only be looked up in aired order. Switch this group back to aired order.",
        };
      let { season, episode } = request;
      let offset = 0;
      if (season === null) {
        for (const [number, slots] of regular) {
          if (episode - offset <= slots.length) {
            season = number;
            break;
          }
          offset += slots.length;
        }
        if (season === null)
          return {
            error: `Episode ${episode} is beyond the ${offset} episodes in this order.`,
          };
        episode -= offset;
      }
      const last = (request.episodeEnd ?? request.episode) - offset;
      if (last < episode || last - episode > 20)
        return { error: "Enter a valid season and episode number." };
      const aired: Episode[] = [];
      for (let number = episode; number <= last; number++) {
        const slot = seasons.get(season)?.[number - 1];
        if (!slot?.length)
          return {
            error: `Season ${season} episode ${number} was not found in this order.`,
          };
        aired.push(...slot);
      }
      const first = aired[0]!;
      const numbers = ordering.keepNumbers
        ? { season, episode, ...(last > episode ? { episodeEnd: last } : {}) }
        : {
            season: first.season,
            episode: first.number,
            ...(aired.length > 1 ? { episodeEnd: aired.at(-1)!.number } : {}),
          };
      // In aired numbering one file can only span a run of consecutive episodes.
      if (
        !ordering.keepNumbers &&
        aired.some(
          (item, index) =>
            item.season !== first.season || item.number !== first.number + index,
        )
      )
        return {
          error:
            "These episodes are not next to each other in aired order, so one file cannot be named for them. Keep the files' own numbers instead.",
        };
      return {
        media: {
          ...candidate,
          ...numbers,
          episodeTitle: aired.map((item) => item.title).join(" & "),
          episodeId: first.id,
          overview: first.overview,
          aired: first.aired,
        },
      };
    });
  }
  /**
   * Resolves many files of one show with one request per season. Absolute episode numbers
   * are counted through the regular seasons in order. Each request gets its own result, so
   * one missing episode does not fail the rest.
   */
  async resolveMany(
    candidate: Candidate,
    requests: EpisodeRequest[],
    language = "en-US",
    ordering: OrderingChoice | null = null,
    /** For anime matched on Kitsu: whose seasons and episode numbers to use. */
    numbering: Catalogue = "tmdb",
  ): Promise<ResolveResult[]> {
    if (candidate.kind === "movie") {
      // A film has no season to place, but the list knows its TMDB and IMDb IDs.
      const media =
        candidate.provider === "kitsu"
          ? await this.animeMap
              ?.lookup(candidate.id)
              .then((found) => ({
                ...candidate,
                tmdbId: found?.tmdbId,
                imdbId: found?.imdbId ?? candidate.imdbId,
              }))
              .catch(() => candidate)
          : candidate;
      return requests.map(() => ({ media: media ?? candidate }));
    }
    if (candidate.provider === "kitsu")
      return this.resolveKitsu(candidate, requests, language, numbering);
    // TVmaze lists backdrops separately from its search results.
    if (candidate.provider === "tvmaze" && candidate.backdropUrl === undefined)
      try {
        const images = await this.request<TvmazeImage[]>(
          "tvmaze",
          `shows/${candidate.id}/images`,
        );
        const backgrounds = Array.isArray(images)
          ? images.filter((image) => image.type === "background")
          : [];
        const chosen = backgrounds.find((image) => image.main) ?? backgrounds[0];
        candidate = {
          ...candidate,
          backdropUrl: chosen?.resolutions?.original?.url,
        };
      } catch {
        // No backdrop is not a reason to fail the episode lookup.
      }
    // TVmaze also lists season posters apart from the episodes.
    const seasonPosters = new Map<number, string>();
    if (candidate.provider === "tvmaze")
      try {
        const listed = await this.request<
          { number?: number; image?: { original?: string | null } | null }[]
        >("tvmaze", `shows/${candidate.id}/seasons`);
        for (const item of Array.isArray(listed) ? listed : [])
          if (Number.isInteger(item.number) && item.image?.original)
            seasonPosters.set(item.number!, item.image.original);
      } catch {
        // Likewise optional.
      }
    if (ordering)
      return this.resolveOrdered(candidate, requests, language, ordering);
    const counts = requests.some((request) => request.season === null)
      ? await this.seasonCounts(candidate)
      : [];
    const seasons = new Map<number, Promise<SeasonListing>>();
    const results: ResolveResult[] = [];
    for (let request of requests) {
      try {
        let { season, episode } = request;
        let offset = 0;
        if (request.airDate) {
          const aired = await this.airedOn(candidate, request.airDate, language);
          if (!aired.length)
            throw new Error(
              `No episode of this show is listed as airing on ${request.airDate}.`,
            );
          if (aired.length > 1)
            throw new Error(
              `${aired.length} episodes aired on ${request.airDate} (${aired
                .map((item) => `S${item.season}E${item.number}`)
                .join(", ")}). Set the season and episode for this file.`,
            );
          season = aired[0]!.season;
          episode = aired[0]!.number;
          request = { season, episode };
        }
        if (season === null) {
          for (const [number, count] of counts) {
            if (episode - offset <= count) {
              season = number;
              break;
            }
            offset += count;
          }
          if (season === null)
            throw new Error(
              `Episode ${episode} is beyond the ${offset} episodes listed for this show.`,
            );
          episode -= offset;
        }
        const last = (request.episodeEnd ?? request.episode) - offset;
        if (
          !Number.isInteger(season) ||
          season < 0 ||
          !Number.isInteger(episode) ||
          episode < 1 ||
          last < episode ||
          last - episode > 20
        )
          throw new Error("Enter a valid season and episode number.");
        let listed = seasons.get(season);
        if (!listed)
          seasons.set(
            season,
            (listed = this.seasonEpisodes(candidate, season, language)),
          );
        const { episodes: all, posterUrl } = await listed;
        const found: Episode[] = [];
        for (let number = episode; number <= last; number++) {
          const match = all.find((item) => item.number === number);
          if (!match)
            throw new Error(
              `Season ${season} episode ${number} was not found for this show.`,
            );
          found.push(match);
        }
        const first = found[0]!;
        results.push({
          media: {
            ...candidate,
            season,
            episode,
            ...(last > episode ? { episodeEnd: last } : {}),
            episodeTitle: found.map((item) => item.title).join(" & "),
            episodeId: first.id,
            overview: first.overview,
            aired: first.aired,
            seasonPosterUrl: posterUrl ?? seasonPosters.get(season),
          },
        });
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }
}
