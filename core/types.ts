export type MediaKind = "movie" | "tv";
export type ProviderName = "tmdb" | "tvmaze" | "kitsu";

export type SkipReason = "sample" | "trailer" | "extra";

export interface ParsedName {
  title: string;
  year: number | null;
  kind: MediaKind;
  /** Null with an episode set means the number is absolute (season-less), as in most anime releases. */
  season: number | null;
  episode: number | null;
  /** Last episode of a multi-episode file. */
  episodeEnd: number | null;
  /** "2024-03-15" for a file named by the day it aired instead of by number. */
  airDate: string | null;
  releaseGroup: string | null;
  /** Set for files that are probably not main features. */
  skip: SkipReason | null;
}

export interface MediaFile {
  id: string;
  path: string;
  /** Folder the file was imported under; organised folders are created inside it. */
  root: string;
  name: string;
  size: number;
  parsed: ParsedName;
}

export interface Candidate {
  provider: ProviderName;
  kind: MediaKind;
  id: number;
  title: string;
  year: number | null;
  overview: string;
  language?: string;
  sourceUrl?: string;
  /** IDs in other catalogues, when the provider knows them; used for folder ID tags. */
  tvdbId?: number;
  /** The TVDB season an anime entry corresponds to, when its provider maps it. */
  tvdbSeason?: number;
  /** The TMDB ID of a match that came from another provider, when a mapping is known. */
  tmdbId?: number;
  imdbId?: string;
  /** Artwork addresses on the provider's image host, when it has any. */
  posterUrl?: string;
  backdropUrl?: string;
}

/** What a provider returns for one season. */
export interface SeasonListing {
  episodes: Episode[];
  posterUrl?: string;
}

export interface Media extends Candidate {
  season?: number;
  episode?: number;
  /** Last episode of a multi-episode file. */
  episodeEnd?: number;
  episodeTitle?: string;
  episodeId?: number;
  aired?: string;
  /** Poster of the episode's season, when the provider has one. */
  seasonPosterUrl?: string;
}

/** Enough of a match to format a name; the rest is optional detail. */
export type MediaLike = Pick<Media, "title" | "kind"> & Partial<Media>;

export interface Fingerprint {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

export interface MoveOperation {
  type: "move";
  source: string;
  target: string;
  fingerprint: Fingerprint;
}

export interface WriteOperation {
  type: "write";
  target: string;
  content: string;
}

export interface MkdirOperation {
  type: "mkdir";
  target: string;
}

/** Removes a source folder the batch has emptied; skipped if anything is still inside. */
export interface RmdirOperation {
  type: "rmdir";
  target: string;
}

/** Fetches a poster or backdrop into a title's folder; a failed download is skipped, not fatal. */
export interface DownloadOperation {
  type: "download";
  url: string;
  target: string;
}

export type Operation =
  | MkdirOperation
  | MoveOperation
  | WriteOperation
  | RmdirOperation
  | DownloadOperation;

export interface NamingTemplates {
  movie: string;
  episode: string;
}

export interface PlanOptions {
  /** Defaults to the Plex layout. */
  templates?: NamingTemplates;
  /** Create the template's folders inside each file's import root. When false, files are renamed in place. */
  organize?: boolean;
  subtitles?: boolean;
  /** Move NFO files and artwork that belong to a video or its folder. Defaults to true. */
  sidecars?: boolean;
  nfo?: boolean;
  /** Remove source folders that organising leaves empty. Defaults to true. */
  removeEmpty?: boolean;
  /** Download a poster and backdrop into each title's folder. Needs `organize`. */
  artwork?: boolean;
}

export interface MediaGroup {
  key: string;
  kind: MediaKind;
  title: string;
  year: number | null;
  fileIds: string[];
}

export interface RankedCandidate {
  candidate: Candidate;
  /** 0 to 1; how well the candidate fits the parsed title and year. */
  score: number;
  /** The score in words. */
  fit: string;
}

export interface Episode {
  season: number;
  number: number;
  title: string;
  id: number;
  aired?: string;
  overview: string;
}

export interface EpisodeRequest {
  /** Null when the episode number is absolute. */
  season: number | null;
  episode: number;
  episodeEnd?: number | null;
  /** Find the episode by the day it aired; `season` and `episode` are then ignored. */
  airDate?: string | null;
}

export type ResolveResult = { media: Media } | { error: string };

export interface Selection {
  file: MediaFile;
  media: MediaLike;
  /**
   * The folder the file was added from, when `file.root` has been pointed at a different
   * destination. Emptied folders are only ever removed strictly inside it.
   */
  sourceRoot?: string;
}

export interface PlanIssue {
  source?: string;
  target?: string;
  message: string;
}

export interface Plan {
  id: string;
  createdAt: string;
  /** One entry per selected file; `changes` lists everything planned for it (video, subtitles, metadata). */
  previews: {
    source: string;
    target: string;
    title: string;
    changes: { source: string | null; target: string; artwork?: boolean }[];
  }[];
  /** The same problems as `errors`, tied to the file or destination they concern. */
  issues: PlanIssue[];
  sourceChecks: { source: string; fingerprint: Fingerprint }[];
  operations: Operation[];
  errors: string[];
}

export type JournalEvent =
  | { type: "plan"; plan: Plan }
  | { type: "intent" | "undo-done"; index: number }
  /** `size` is recorded for downloads, so undo only removes a file it still recognises. */
  | { type: "done"; index: number; size?: number }
  | { type: "skipped"; index: number; message: string }
  | { type: "complete" | "undone" }
  | { type: "failed"; message: string };

export type BatchStatus = "complete" | "interrupted" | "undone" | "damaged";

export interface BatchSummary {
  id: string;
  createdAt: string;
  count: number;
  status: BatchStatus;
  operations: { type: Operation["type"]; source?: string; target: string }[];
}

export interface ScanResult {
  files: MediaFile[];
  skipped: string[];
}

// ---- Queue, preview and settings as the interface sees them ----

export type GroupStatus =
  | "matching"
  | "suggested"
  | "review"
  | "unmatched"
  | "confirmed";

export interface QueueCandidate extends Candidate {
  fit: string;
  /** Not a close fit to the filename. */
  weak: boolean;
}

export interface QueueFile {
  id: string;
  /** Path relative to the folder it was imported from. */
  source: string;
  /** "S01E02-E03", "#12 → S01E12" for absolute numbers, or "film". */
  label: string;
  /** New path relative to the destination, when one can be worked out. */
  target: string | null;
  issue: string | null;
  excluded: boolean;
  /** The numbers read from the filename, or as corrected by hand. */
  numbers: EpisodeNumbers;
}

export interface EpisodeNumbers {
  /** Null when the episode number is absolute. */
  season: number | null;
  episode: number | null;
  /** Last episode of a multi-episode file. */
  episodeEnd: number | null;
}

export interface QueueGroup {
  key: string;
  kind: MediaKind;
  /** Searched as anime, which adds Kitsu to the sources. */
  anime: boolean;
  parsedTitle: string;
  status: GroupStatus;
  reason: string;
  candidates: QueueCandidate[];
  chosen: number | null;
  query: string;
  files: QueueFile[];
  /** Other ways the chosen show's episodes are numbered, e.g. DVD order; empty if none. */
  orderings: EpisodeOrdering[];
  /** The ordering the files' numbers are read in; null for the usual aired order. */
  ordering: string | null;
  /** Keep the files' own numbers in the new names instead of converting to aired order. */
  keepNumbers: boolean;
  /** For anime matched on Kitsu: whose seasons and episode numbers the new names use. */
  numbering: Catalogue;
  /** Whether that choice applies to this group's current match. */
  numberingChoice: boolean;
}

export type Catalogue = "tmdb" | "tvdb";

export interface EpisodeOrdering {
  id: string;
  name: string;
}

export interface OrderingChoice {
  id: string;
  keepNumbers: boolean;
}

export interface QueueState {
  groups: QueueGroup[];
  skipped: { id: string; source: string; reason: SkipReason }[];
  /** Where organised folders are created; empty when the queue is empty. */
  destination: string;
  destinationChanged: boolean;
  /** Progress of the lookups started by adding files; null when none are running. */
  lookups: { done: number; total: number } | null;
}

export interface PreviewItem {
  fileId: string;
  kind: "video" | "subtitle" | "metadata" | "artwork";
  /** New path relative to the destination. */
  to: string;
  from: string | null;
  problem: string | null;
}

export interface PreviewGroup {
  key: string;
  kind: MediaKind;
  title: string;
  year: number | null;
  items: PreviewItem[];
  /** Files of this group that will not be touched. */
  left: string[];
  problems: string[];
}

export interface PreviewState {
  id: string;
  destination: string;
  groups: PreviewGroup[];
  /** Folders that will be created, relative to the destination. */
  newFolders: string[];
  /** Source folders the batch empties and will remove. */
  removedFolders: string[];
  counts: {
    videos: number;
    subtitles: number;
    metadata: number;
    artwork: number;
    folders: number;
    removed: number;
    left: number;
    operations: number;
  };
  /** Problems not tied to one group. */
  errors: string[];
  blocked: boolean;
}

export type NamingPreset = "plex" | "jellyfin" | "custom";

export interface AppSettings {
  preset: NamingPreset;
  templates: NamingTemplates;
  organize: boolean;
  subtitles: boolean;
  nfo: boolean;
  /** Move existing NFO files and artwork along with the videos they belong to. */
  sidecars: boolean;
  /** Remove source folders that organising leaves empty. */
  removeEmpty: boolean;
  /** Download a poster and backdrop into each title's folder. */
  artwork: boolean;
  /** Language for titles, e.g. "en-US". */
  language: string;
  /** Set samples, trailers and extras aside on import. */
  skipExtras: boolean;
  /** Look up matches as soon as files are added. */
  autoMatch: boolean;
  /** For anime releases, search again under the English title Kitsu lists when the lookup is unsure. */
  animeTitles: boolean;
  /** Place Kitsu matches in their TMDB or TVDB season using a downloaded community list. */
  animeSeasons: boolean;
}

export interface SourcesState {
  /** "saved" in the OS keychain, "session" in memory until quit, or "none". */
  tmdb: "saved" | "session" | "none";
  /** The optional TVDB key, held the same way. */
  tvdb: "saved" | "session" | "none";
  /** Whether this system offers a keychain to save the token in. */
  canSave: boolean;
}

export interface SearchRequest {
  query: string;
  /** "anime" keeps the group's film or TV kind and adds Kitsu to the sources searched. */
  kind: MediaKind | "anime";
}
