import { groupFiles, rankCandidates } from "./group.ts";
import { renderTemplate } from "./naming.ts";
import type { Providers } from "./providers.ts";
import type {
  AppSettings,
  Candidate,
  Catalogue,
  EpisodeNumbers,
  EpisodeOrdering,
  MediaFile,
  MediaKind,
  Plan,
  PlanOptions,
  PreviewGroup,
  PreviewItem,
  PreviewState,
  ProviderName,
  QueueCandidate,
  QueueFile,
  QueueGroup,
  QueueState,
  ResolveResult,
  ScanResult,
  SearchRequest,
  Selection,
} from "./types.ts";

/** The filesystem half of the engine, injected so the queue logic runs anywhere. */
export interface Planner {
  createPlan(selections: Selection[], options: PlanOptions): Promise<Plan>;
  applyPlan(
    plan: Plan,
  ): Promise<{
    id: string;
    completed: number;
    warnings?: string[];
    /** Imported folders that now have a new name. */
    renamed?: { from: string; to: string }[];
  }>;
}

interface Group {
  key: string;
  kind: MediaKind;
  anime: boolean;
  parsedTitle: string;
  year: number | null;
  fileIds: string[];
  status: QueueGroup["status"];
  reason: string;
  candidates: QueueCandidate[];
  chosen: number | null;
  query: string;
  results: Map<string, ResolveResult>;
  orderings: EpisodeOrdering[];
  ordering: string | null;
  keepNumbers: boolean;
  numbering: Catalogue;
  /** The other title an anime was found under, when Kitsu supplied it. */
  via?: string;
  /** Says which sources could not be searched, when some could. */
  missed?: string;
  /** Bumped whenever a lookup starts, so a slower earlier lookup cannot overwrite a newer one. */
  lookup: number;
  /** The status to return to if a queued lookup is cancelled. */
  before?: QueueGroup["status"];
}

/** One batch of queued lookups; cancelling replaces it so late finishers are not counted. */
interface LookupRun {
  done: number;
  total: number;
  cancelled: boolean;
}
interface LookupJob {
  group: Group;
  run: LookupRun;
  finish: () => void;
}
const newRun = (): LookupRun => ({ done: 0, total: 0, cancelled: false });

const SOURCES: Record<ProviderName, string> = {
  tmdb: "TMDB",
  tvmaze: "TVmaze",
  kitsu: "Kitsu",
};
const SUBTITLE = /\.(srt|ass|ssa|vtt|sub|idx)$/i;
const PICTURE = /\.(jpe?g|png|webp|tbn)$/i;
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const two = (value: number) => String(value).padStart(2, "0");
// Paths are handled as text so this module needs nothing from Node.
const separatorOf = (value: string) => (value.includes("\\") ? "\\" : "/");
const relativeTo = (value: string, root: string) =>
  value.startsWith(root) ? value.slice(root.length).replace(/^[\\/]+/, "") : value;
const parentOf = (value: string) => value.replace(/[\\/]?[^\\/]*$/, "");
const extensionOf = (value: string) =>
  (/\.[^.\\/]+$/.exec(value)?.[0] ?? "").toLowerCase();

/**
 * The queue behind the interface: imported files grouped by show or film, the match
 * suggested or chosen for each group, and the plan built from the confirmed ones.
 * Every change is reported through `onChange`.
 */
export class Session {
  private files = new Map<string, MediaFile>();
  private excluded = new Set<string>();
  private groups = new Map<string, Group>();
  private destination: string | null = null;
  private plan: { plan: Plan; fileIds: string[] } | null = null;
  private manualGroups = 0;
  private run = newRun();
  private waiting: LookupJob[] = [];
  private active = new Set<LookupJob>();
  private providers: Providers;
  private planner: Planner;
  private settings: AppSettings;
  private onChange: (state: QueueState) => void;

  constructor(options: {
    providers: Providers;
    planner: Planner;
    settings: AppSettings;
    onChange?: (state: QueueState) => void;
  }) {
    this.providers = options.providers;
    this.planner = options.planner;
    this.settings = options.settings;
    this.onChange = options.onChange ?? (() => {});
  }

  // ---- Reading ----

  state(): QueueState {
    const all = [...this.files.values()];
    const roots = [...new Set(all.map((file) => file.root))];
    return {
      groups: [...this.groups.values()].map((group) => this.describe(group)),
      skipped: all
        .filter((file) => file.parsed.skip)
        .map((file) => ({
          id: file.id,
          source: relativeTo(file.path, file.root),
          reason: file.parsed.skip!,
        })),
      destination:
        this.destination ??
        (roots.length === 1
          ? roots[0]!
          : roots.length
            ? "The folder each file was added from"
            : ""),
      destinationChanged: this.destination !== null,
      lookups: this.run.total
        ? { done: this.run.done, total: this.run.total }
        : null,
    };
  }

  private rootOf(file: MediaFile) {
    return this.destination ?? file.root;
  }

  private mediaOf(group: Group, fileId: string) {
    const result = group.results.get(fileId);
    return result && "media" in result ? result.media : null;
  }

  private describeFile(group: Group, file: MediaFile): QueueFile {
    const result = group.results.get(file.id);
    const media = this.mediaOf(group, file.id);
    const { parsed } = file;
    let label = "film",
      target: string | null = null,
      issue = result && "error" in result ? result.error : null;
    if (group.kind === "tv") {
      const season = media?.season ?? parsed.season,
        episode = media?.episode ?? parsed.episode,
        end = media?.episodeEnd ?? parsed.episodeEnd;
      const code =
        episode === null
          ? ""
          : `${season === null ? "" : `S${two(season)}`}E${two(episode)}${end ? `-E${two(end)}` : ""}`;
      label =
        parsed.episode === null && parsed.airDate
          ? `${parsed.airDate}${code ? ` → ${code}` : ""}`
          : parsed.episode === null && parsed.episodeTitle && code
          ? `“${parsed.episodeTitle}” → ${code}`
          : episode === null
          ? "no number"
          : `${parsed.season === null && media ? `#${parsed.episode} → ` : ""}${season === null ? "" : `S${two(season)}`}E${two(episode)}${end ? `-E${two(end)}` : ""}`;
    }
    if (media) {
      try {
        const { templates, organize } = this.settings;
        const segments = renderTemplate(
          media.kind === "tv" ? templates.episode : templates.movie,
          media,
        );
        const source = relativeTo(file.path, file.root);
        const folder = organize ? segments.slice(0, -1) : [parentOf(source)];
        target =
          [...folder, segments.at(-1)].filter(Boolean).join("/") +
          extensionOf(file.name);
      } catch (error) {
        issue = messageOf(error);
      }
    }
    return {
      id: file.id,
      source: relativeTo(file.path, file.root),
      path: file.path,
      label,
      target,
      issue,
      excluded: this.excluded.has(file.id),
      numbers: {
        season: parsed.season,
        episode: parsed.episode,
        episodeEnd: parsed.episodeEnd,
      },
    };
  }

  private describe(group: Group): QueueGroup {
    return {
      key: group.key,
      kind: group.kind,
      anime: group.anime,
      parsedTitle: group.parsedTitle,
      status: group.status,
      reason: group.reason,
      candidates: group.candidates,
      chosen: group.chosen,
      query: group.query,
      orderings: group.orderings,
      ordering: group.ordering,
      keepNumbers: group.keepNumbers,
      numbering: group.numbering,
      numberingChoice:
        group.kind === "tv" &&
        this.settings.animeSeasons &&
        group.candidates[group.chosen ?? -1]?.provider === "kitsu",
      files: group.fileIds.map((id) =>
        this.describeFile(group, this.files.get(id)!),
      ),
    };
  }

  private changed() {
    this.plan = null;
    this.onChange(this.state());
  }

  // ---- Adding and removing ----

  /** Adds scanned files and looks up matches for the groups they form or join. */
  async addFiles(scan: ScanResult): Promise<void> {
    const known = new Set([...this.files.values()].map((file) => file.path));
    const fresh = scan.files.filter((file) => !known.has(file.path));
    for (const file of fresh) {
      if (!this.settings.skipExtras) file.parsed.skip = null;
      this.files.set(file.id, file);
    }
    await this.place(fresh);
  }

  private async place(files: MediaFile[]) {
    const touched: Group[] = [];
    for (const found of groupFiles(files).groups) {
      let group = this.groups.get(found.key);
      if (group) group.fileIds.push(...found.fileIds);
      else {
        group = {
          key: found.key,
          kind: found.kind,
          anime: false,
          parsedTitle: found.title,
          year: found.year,
          fileIds: found.fileIds,
          status: "unmatched",
          reason: "Search to find a match.",
          candidates: [],
          chosen: null,
          query: found.title,
          results: new Map(),
          orderings: [],
          ordering: null,
          keepNumbers: false,
          numbering: "tmdb",
          lookup: 0,
        };
        group.anime = this.looksLikeAnime(group);
        this.groups.set(group.key, group);
      }
      touched.push(group);
    }
    this.changed();
    await this.schedule(
      touched.filter(
        (group) => group.chosen !== null || this.settings.autoMatch,
      ),
    );
  }

  /**
   * Queues lookups for these groups and resolves once each has finished or been
   * cancelled. A few run at a time: quick for a folder of shows without flooding
   * the provider.
   */
  private schedule(groups: Group[]): Promise<void> {
    if (!groups.length) return Promise.resolve();
    const run = this.run;
    run.total += groups.length;
    const jobs = groups.map((group) => {
      if (group.status !== "matching") group.before = group.status;
      group.status = "matching";
      group.reason = "Waiting to be looked up.";
      group.lookup++;
      return new Promise<void>((finish) =>
        this.waiting.push({ group, run, finish }),
      );
    });
    this.changed();
    this.pump();
    return Promise.all(jobs).then(() => {});
  }

  private pump() {
    while (this.active.size < 3 && this.waiting.length) {
      const job = this.waiting.shift()!;
      const { group, run } = job;
      this.active.add(job);
      void (async () => {
        try {
          if (run.cancelled || !this.groups.has(group.key)) return;
          if (group.chosen !== null) await this.resolve(group, group.before);
          else await this.lookUp(group);
        } finally {
          this.active.delete(job);
          if (run === this.run) {
            if (++run.done >= run.total) this.run = newRun();
            this.onChange(this.state());
          }
          job.finish();
          this.pump();
        }
      })();
    }
  }

  /**
   * Stops the lookups started by adding files. Groups not yet looked up are left for
   * a manual search; anything already matched keeps its match.
   */
  cancelLookups() {
    if (!this.run.total) return;
    this.run.cancelled = true;
    this.run = newRun();
    const queued = this.waiting.splice(0);
    for (const { group } of [...queued, ...this.active]) {
      // Discards whatever an in-flight request for this group returns.
      group.lookup++;
      // Only a group that already had names worked out keeps its match.
      if (group.chosen !== null && group.results.size && group.before) {
        group.status = group.before;
        group.reason = "Lookup cancelled. Search to refresh this group.";
      } else
        this.unmatched(group, "Lookup cancelled. Search to find a match.");
    }
    this.providers.cancel();
    queued.forEach((job) => job.finish());
    this.changed();
  }

  remove(key: string) {
    const group = this.groups.get(key);
    if (!group) return;
    for (const id of group.fileIds) {
      this.files.delete(id);
      this.excluded.delete(id);
    }
    this.groups.delete(key);
    if (!this.files.size) this.destination = null;
    this.changed();
  }

  clear() {
    this.files.clear();
    this.groups.clear();
    this.excluded.clear();
    this.destination = null;
    this.changed();
  }

  /** Moves a file that was set aside as a sample or extra into the queue. */
  async include(fileId: string) {
    const file = this.files.get(fileId);
    if (!file?.parsed.skip) return;
    file.parsed.skip = null;
    await this.place([file]);
  }

  /** Leaves a file out of the next batch without removing it from its group. */
  exclude(fileId: string, excluded: boolean) {
    if (!this.files.has(fileId)) return;
    if (excluded) this.excluded.add(fileId);
    else this.excluded.delete(fileId);
    this.changed();
  }

  /**
   * Moves files into another group, or into a new group of their own when `targetKey`
   * is null. This is how a group is split, and moving every file of a group merges it.
   * Returns the key of the group the files ended up in.
   */
  async moveFiles(fileIds: string[], targetKey: string | null): Promise<string> {
    if (!Array.isArray(fileIds) || !fileIds.length)
      throw new Error("Choose at least one file to move.");
    const moving = new Set(fileIds);
    const owner = (fileId: string) =>
      [...this.groups.values()].find((item) => item.fileIds.includes(fileId));
    const sources = new Set<Group>();
    for (const fileId of moving) {
      const from = owner(fileId);
      if (!from) throw new Error("That file is no longer in the queue.");
      if (from.key !== targetKey) sources.add(from);
    }
    const first = [...sources][0];
    if (!first) return targetKey!;
    let target: Group;
    if (targetKey === null) {
      const { parsed } = this.files.get(fileIds[0]!)!;
      target = {
        key: `manual:${++this.manualGroups}`,
        kind: first.kind,
        anime: first.anime,
        parsedTitle: parsed.title || first.parsedTitle,
        year: parsed.year,
        fileIds: [],
        status: "unmatched",
        reason: "Search to find a match.",
        candidates: [],
        chosen: null,
        query: parsed.title || first.query,
        results: new Map(),
        orderings: [],
        ordering: null,
        keepNumbers: false,
        numbering: first.numbering,
        lookup: 0,
      };
      this.groups.set(target.key, target);
    } else target = this.group(targetKey);

    for (const from of sources) {
      const leaving = from.fileIds.filter((fileId) => moving.has(fileId));
      from.fileIds = from.fileIds.filter((fileId) => !moving.has(fileId));
      leaving.forEach((fileId) => from.results.delete(fileId));
      target.fileIds.push(...leaving);
      if (!from.fileIds.length) this.groups.delete(from.key);
    }
    this.changed();
    // Refresh both sides: the moved files need the target's match, and each source's
    // summary no longer counts them.
    for (const from of sources)
      if (this.groups.has(from.key) && from.chosen !== null)
        await this.resolve(from);
    if (target.chosen !== null) await this.resolve(target);
    else if (targetKey === null && this.settings.autoMatch)
      await this.lookUp(target);
    return target.key;
  }

  /**
   * Corrects the season and episode read from a filename, then looks the file up again.
   * A null season means the episode number is absolute.
   */
  async setEpisode(fileId: string, numbers: EpisodeNumbers) {
    const file = this.files.get(fileId);
    const group = [...this.groups.values()].find((item) =>
      item.fileIds.includes(fileId),
    );
    if (!file || !group) throw new Error("That file is no longer in the queue.");
    const { season = null, episode, episodeEnd = null } = numbers ?? {};
    const whole = (value: unknown, min: number, max: number): value is number =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= min &&
      value <= max;
    if (season !== null && !whole(season, 0, 999))
      throw new Error("Enter a season from 0 to 999, or leave it empty.");
    if (!whole(episode, 1, 9999))
      throw new Error("Enter an episode number from 1 to 9999.");
    if (episodeEnd !== null && !whole(episodeEnd, episode + 1, episode + 20))
      throw new Error(
        "The last episode must come after the first, at most 20 later.",
      );
    // Numbers given by hand replace a date read from the name.
    Object.assign(file.parsed, {
      season,
      episode,
      episodeEnd,
      airDate: null,
      episodeTitle: null,
    });
    if (group.chosen === null) this.changed();
    else await this.resolve(group);
  }

  setDestination(folder: string | null) {
    this.destination = folder;
    this.changed();
  }

  updateSettings(settings: AppSettings) {
    this.settings = settings;
    this.changed();
  }

  // ---- Matching ----

  private group(key: string): Group {
    const group = this.groups.get(key);
    if (!group) throw new Error("That group is no longer in the queue.");
    return group;
  }

  /**
   * Fansub-style names: a leading [Group] tag, or episode numbers with no season. Such a
   * group starts out searched as anime.
   */
  private looksLikeAnime(group: Group) {
    return group.fileIds.some((id) => {
      const { parsed } = this.files.get(id)!;
      return (
        parsed.releaseGroup !== null ||
        (parsed.season === null && parsed.episode !== null)
      );
    });
  }

  private unmatched(group: Group, reason: string) {
    group.status = "unmatched";
    group.chosen = null;
    group.orderings = [];
    group.ordering = null;
    group.results.clear();
    group.reason = reason;
  }

  private async lookUp(group: Group) {
    const lookup = ++group.lookup;
    group.status = "matching";
    group.reason = "Looking up matches.";
    this.changed();
    try {
      const input = {
        kind: group.kind,
        anime: group.anime,
        query: group.query,
        language: this.settings.language,
      };
      const { found, failed } = await this.providers.searchAll({
        ...input,
        year: group.year,
      });
      if (lookup !== group.lookup || !this.groups.has(group.key)) return;
      if (!found.length) {
        if (group.kind === "movie" && !this.providers.hasToken)
          throw new Error("Add a TMDB token in Settings to match films.");
        if (failed[0]) throw new Error(failed[0].message);
      }
      const names = failed.map((item) => SOURCES[item.provider]);
      group.missed = names.length
        ? `${names.join(" and ")} could not be searched, so ${names.length === 1 ? "its" : "their"} results are missing.`
        : "";
      let { ranked, confident, rival } = rankCandidates(
        { title: group.query, year: group.year },
        found,
      );
      // Anime is often released under its romaji title, which general catalogues list
      // under the English one. Ask Kitsu what else it is called and try again.
      let via = "";
      if (!confident && group.anime && this.settings.animeTitles) {
        const titles = await this.providers
          .alternativeTitles(group.kind, group.query)
          .catch(() => []);
        for (const title of titles.slice(0, 2)) {
          const again = rankCandidates(
            { title, year: null },
            (await this.providers.searchAll({ ...input, query: title })).found,
          );
          if (!again.confident) continue;
          ({ ranked, confident, rival } = again);
          via = title;
          break;
        }
        if (lookup !== group.lookup || !this.groups.has(group.key)) return;
      }
      group.via = via;
      group.candidates = ranked.map(({ candidate, score, fit }) => ({
        ...candidate,
        fit,
        weak: score < 0.85,
      }));
      const [best] = ranked;
      if (!best)
        this.unmatched(group, "No results. Edit the title and search again.");
      else if (!confident && rival && rival.score >= 0.85)
        this.unmatched(
          group,
          ["More than one result fits this name equally well. Choose one.", group.missed]
            .filter(Boolean)
            .join(" "),
        );
      else {
        group.chosen = 0;
        group.orderings = [];
        group.ordering = null;
        group.keepNumbers = false;
        await this.resolve(group, confident ? "suggested" : "review", lookup);
        return;
      }
    } catch (error) {
      if (lookup !== group.lookup) return;
      group.candidates = [];
      this.unmatched(group, messageOf(error));
    }
    this.changed();
  }

  /** Fetches what the chosen match needs for every file in the group, e.g. episode titles. */
  private async resolve(
    group: Group,
    status: Group["status"] = group.status,
    lookup = ++group.lookup,
  ) {
    const candidate = group.candidates[group.chosen ?? -1];
    if (!candidate) return;
    const files = group.fileIds.map((id) => this.files.get(id)!);
    const results = new Map<string, ResolveResult>();
    try {
      const numbered = files.filter(
        (file) =>
          group.kind === "movie" ||
          file.parsed.episode !== null ||
          file.parsed.airDate !== null ||
          file.parsed.episodeTitle !== null,
      );
      const resolved = await this.providers.resolveMany(
        candidate,
        numbered.map(({ parsed }) => ({
          season: parsed.season,
          episode: parsed.episode ?? 1,
          episodeEnd: parsed.episodeEnd,
          airDate: parsed.episode === null ? parsed.airDate : null,
          title: parsed.episodeTitle,
          byTitle: parsed.episode === null && parsed.airDate === null,
        })),
        this.settings.language,
        group.ordering
          ? { id: group.ordering, keepNumbers: group.keepNumbers }
          : null,
        group.numbering,
      );
      // Offer the show's other orderings; having none, or failing to list them, is fine.
      if (group.kind === "tv" && !group.ordering)
        group.orderings = await this.providers
          .orderings(candidate)
          .catch(() => []);
      numbered.forEach((file, index) => results.set(file.id, resolved[index]!));
      for (const file of files)
        if (!results.has(file.id))
          results.set(file.id, {
            error: "No episode number was found in this filename.",
          });
    } catch (error) {
      for (const file of files)
        results.set(file.id, { error: messageOf(error) });
    }
    if (lookup !== group.lookup || !this.groups.has(group.key)) return;
    group.results = results;
    group.status = status;
    const problems = [...results.values()].filter((r) => "error" in r).length;
    const seasonless = files.filter(
      (file) => group.kind === "tv" && file.parsed.season === null && file.parsed.episode !== null,
    );
    // A season-less number the lookup read as season and episode run together, e.g. 812.
    const joined = seasonless.filter((file) => {
      const result = results.get(file.id);
      return (
        result &&
        "media" in result &&
        result.media.season! * 100 + result.media.episode! === file.parsed.episode
      );
    });
    const absolute = seasonless.length > joined.length;
    const named = files.filter((file) => {
      const result = results.get(file.id);
      return (
        group.kind === "tv" &&
        file.parsed.episode === null &&
        file.parsed.airDate === null &&
        result &&
        "media" in result
      );
    }).length;
    group.reason = [
      status === "confirmed"
        ? "You confirmed this match."
        : status === "suggested"
          ? `${candidate.fit}.`
          : `${candidate.fit}, so this is the closest result rather than a certain match.`,
      group.via && status !== "confirmed"
        ? `Found under its other title “${group.via}”, which Kitsu lists for “${group.query}”.`
        : "",
      status !== "confirmed" ? group.missed : "",
      absolute
        ? "Episode numbers had no season and were counted from the start of the show."
        : "",
      joined.length
        ? `Numbers like ${joined[0]!.parsed.episode} were read as season and episode run together.`
        : "",
      named
        ? `${named} file${named === 1 ? " was" : "s were"} matched by episode name, having no number.`
        : "",
      this.numberingNote(group, candidate, results),
      group.ordering
        ? `Numbers are read in ${group.orderings.find((item) => item.id === group.ordering)?.name ?? "an alternate order"}${group.keepNumbers ? " and kept in the new names" : " and converted to aired order"}.`
        : "",
      problems
        ? `${problems} file${problems === 1 ? "" : "s"} could not be matched and will be left where ${problems === 1 ? "it is" : "they are"}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    this.changed();
  }

  /** Looks up again every group that has no results, e.g. after a token was added. */
  async retryUnmatched() {
    await this.schedule(
      [...this.groups.values()].filter(
        (group) => group.status === "unmatched" && !group.candidates.length,
      ),
    );
  }

  async search(key: string, request: SearchRequest) {
    const group = this.group(key);
    if (typeof request?.query !== "string" || !request.query.trim())
      throw new Error("Enter a title to search.");
    group.query = request.query.trim();
    group.anime = request.kind === "anime";
    if (!group.anime) group.kind = request.kind === "tv" ? "tv" : "movie";
    // The typed title replaces the parsed one, so its year no longer applies.
    if (group.query !== group.parsedTitle) group.year = null;
    await this.lookUp(group);
  }

  /** For a Kitsu match, says whose numbering ended up in the names when that is not the default. */
  private numberingNote(
    group: Group,
    candidate: Candidate,
    results: Map<string, ResolveResult>,
  ) {
    if (candidate.provider !== "kitsu" || group.kind !== "tv") return "";
    const media = [...results.values()].flatMap((result) =>
      "media" in result ? [result.media] : [],
    )[0];
    if (!media || group.numbering !== "tvdb") return "";
    return media.tvdbId && !media.tmdbId
      ? "Seasons and episodes are numbered as TVDB lists them; set this show to TVDB ordering in Plex."
      : "TVDB numbering is not known for this entry, so TMDB's is used.";
  }

  /**
   * For anime matched on Kitsu, chooses whose seasons and episode numbers the new names
   * use. TVDB's is where the mapping list places most specials.
   */
  async setNumbering(key: string, numbering: Catalogue) {
    const group = this.group(key);
    group.numbering = numbering === "tvdb" ? "tvdb" : "tmdb";
    if (group.chosen !== null) await this.resolve(group);
    else this.changed();
  }

  /**
   * Says which order the files' episode numbers are in. With `keepNumbers` the new names
   * keep those numbers; otherwise they are converted to the usual aired numbering.
   */
  async setOrdering(key: string, id: string | null, keepNumbers: boolean) {
    const group = this.group(key);
    if (id !== null && !group.orderings.some((item) => item.id === id))
      throw new Error("That episode order is not available for this show.");
    group.ordering = id;
    group.keepNumbers = id !== null && keepNumbers === true;
    if (group.chosen !== null) await this.resolve(group);
  }

  async choose(key: string, index: number) {
    const group = this.group(key);
    if (!group.candidates[index]) throw new Error("Search again and choose a result.");
    // Orderings belong to one show; a different choice starts from aired order again.
    if (index !== group.chosen) {
      group.orderings = [];
      group.ordering = null;
      group.keepNumbers = false;
    }
    group.chosen = index;
    await this.resolve(group, "confirmed");
  }

  confirm(key: string) {
    const group = this.group(key);
    if (group.chosen === null || group.status === "matching") return;
    group.status = "confirmed";
    this.changed();
  }

  confirmSuggested() {
    for (const group of this.groups.values())
      if (group.status === "suggested") group.status = "confirmed";
    this.changed();
  }

  // ---- Preview and apply ----

  async preview(): Promise<PreviewState> {
    const confirmed = [...this.groups.values()].filter(
      (group) => group.status === "confirmed",
    );
    const selections: (Selection & { group: Group })[] = [];
    for (const group of confirmed)
      for (const id of group.fileIds) {
        const media = this.mediaOf(group, id);
        const file = this.files.get(id)!;
        if (media && !this.excluded.has(id))
          selections.push({
            group,
            media,
            file: { ...file, root: this.rootOf(file) },
            sourceRoot: file.root,
          });
      }
    if (!selections.length)
      throw new Error("Confirm at least one group with a matched file first.");
    const {
      templates,
      organize,
      subtitles,
      sidecars,
      nfo,
      removeEmpty,
      artwork,
    } = this.settings;
    const plan = await this.planner.createPlan(
      selections.map(({ file, media, sourceRoot }) => ({
        file,
        media,
        sourceRoot,
      })),
      { templates, organize, subtitles, sidecars, nfo, removeEmpty, artwork },
    );
    this.plan = { plan, fileIds: selections.map(({ file }) => file.id) };

    // An imported folder that takes its title's name is shown under that name, beside its
    // old one, the way a new title folder would be.
    const renames = plan.operations.filter((op) => op.type === "rename");
    const shown = (target: string, root: string) => {
      const rename = renames.find((op) => op.source === root);
      const inside = relativeTo(target, root);
      return (
        rename
          ? [relativeTo(rename.target, parentOf(rename.target)), inside]
          : [inside]
      )
        .join("/")
        .split(separatorOf(target))
        .join("/");
    };
    const attached = new Set<object>();
    const problemFor = (match: (issue: Plan["issues"][number]) => boolean) => {
      const found = plan.issues.filter(match);
      found.forEach((issue) => attached.add(issue));
      return found.length ? found.map((issue) => issue.message).join(" ") : null;
    };
    const groups = new Map<string, PreviewGroup>();
    for (const { group, file } of selections) {
      const candidate = group.candidates[group.chosen!]!;
      let entry = groups.get(group.key);
      if (!entry) {
        entry = {
          key: group.key,
          kind: group.kind,
          title: candidate.title,
          year: candidate.year,
          items: [],
          left: [],
          problems: [],
        };
        groups.set(group.key, entry);
      }
      const planned = plan.previews.find((item) => item.source === file.path);
      const failed = problemFor((issue) => issue.source === file.path);
      if (failed) entry.problems.push(`${file.name}: ${failed}`);
      for (const { source: from, target, artwork, note } of planned?.changes ?? []) {
        const item: PreviewItem = {
          fileId: file.id,
          kind:
            artwork || (from && PICTURE.test(from))
              ? "artwork"
              : !from || /\.nfo$/i.test(from)
                ? "metadata"
                : SUBTITLE.test(from)
                  ? "subtitle"
                  : "video",
          to: shown(target, file.root),
          from: from && relativeTo(from, this.files.get(file.id)!.root),
          problem: problemFor((issue) => issue.target === target),
          note: note ?? null,
        };
        entry.items.push(item);
      }
    }
    for (const group of confirmed) {
      const entry = groups.get(group.key);
      if (!entry) continue;
      const planned = new Set(entry.items.map((item) => item.fileId));
      entry.left = group.fileIds
        .filter((id) => !planned.has(id))
        .map((id) => {
          const file = this.files.get(id)!;
          return relativeTo(file.path, file.root);
        });
    }
    const list = [...groups.values()];
    const items = list.flatMap((group) => group.items);
    const count = (kind: PreviewItem["kind"]) =>
      items.filter((item) => item.kind === kind).length;
    const folders = plan.operations.filter((op) => op.type === "mkdir");
    const queued = this.state().destination;
    const destination = renames.some((op) => op.source === queued)
      ? parentOf(queued)
      : queued;
    const roots = [...new Set(selections.map((item) => item.sourceRoot!))];
    const removed = plan.operations
      .filter((op) => op.type === "rmdir")
      .map((op) => {
        const root = roots.find((item) => op.target.startsWith(item)) ?? "";
        return relativeTo(op.target, root).split(separatorOf(op.target)).join("/");
      });
    return {
      id: plan.id,
      destination,
      groups: list,
      newFolders: folders.map((op) =>
        shown(
          op.target,
          renames.find((item) => op.target.startsWith(item.source))?.source ?? queued,
        ),
      ),
      removedFolders: removed,
      renamedFolders: renames.map((op) => ({
        from: relativeTo(op.source, parentOf(op.source)),
        to: relativeTo(op.target, parentOf(op.target)),
      })),
      counts: {
        videos: count("video"),
        subtitles: count("subtitle"),
        metadata: count("metadata"),
        artwork: count("artwork"),
        folders: folders.length,
        removed: removed.length,
        renamed: renames.length,
        left: list.reduce((total, group) => total + group.left.length, 0),
        operations: plan.operations.length,
      },
      errors: plan.issues
        .filter((issue) => !attached.has(issue))
        .map((issue) => issue.message)
        .concat(plan.issues.length ? [] : plan.errors),
      blocked: plan.errors.length > 0 || plan.operations.length === 0,
    };
  }

  /** The plan last previewed, for a confirmation prompt; null once the queue has changed. */
  pending(id: string): Plan | null {
    return this.plan?.plan.id === id ? this.plan.plan : null;
  }

  /**
   * Applies the previewed plan. Renamed files leave the queue; everything else stays,
   * including files of the same groups that were left out.
   */
  async apply(id: string) {
    const pending = this.plan;
    if (!pending || pending.plan.id !== id)
      throw new Error("The queue changed. Open Preview again first.");
    let renamed: { from: string; to: string }[] = [];
    try {
      const result = await this.planner.applyPlan(pending.plan);
      renamed = result.renamed ?? [];
      return result;
    } catch (error) {
      const partial = (error as { renamed?: unknown } | null)?.renamed;
      if (Array.isArray(partial)) renamed = partial;
      throw error;
    } finally {
      // Whether or not every operation ran, these paths can no longer be trusted.
      const gone = new Set(pending.fileIds);
      for (const fileId of gone) {
        this.files.delete(fileId);
        this.excluded.delete(fileId);
      }
      for (const group of [...this.groups.values()]) {
        if (!group.fileIds.some((fileId) => gone.has(fileId))) continue;
        group.fileIds = group.fileIds.filter((fileId) => !gone.has(fileId));
        if (!group.fileIds.length) this.groups.delete(group.key);
        else {
          group.status = "review";
          group.reason =
            "The rest of this group was renamed. These files were left where they are.";
        }
      }
      if (!this.files.size) this.destination = null;
      this.relocate(renamed);
    }
  }

  /** Follows folders that were renamed, by a batch or by undoing one, so queued files are still found. */
  relocate(renamed: { from: string; to: string }[]) {
    const moved = (value: string) => {
      for (const { from, to } of renamed)
        if (value === from || value.startsWith(from + separatorOf(from)))
          return to + value.slice(from.length);
      return value;
    };
    for (const [id, file] of this.files)
      this.files.set(id, { ...file, path: moved(file.path), root: moved(file.root) });
    if (this.destination !== null) this.destination = moved(this.destination);
    this.changed();
  }
}
