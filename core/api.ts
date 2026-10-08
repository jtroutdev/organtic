import type {
  AppSettings,
  BatchSummary,
  Catalogue,
  EpisodeNumbers,
  PreviewState,
  QueueState,
  SearchRequest,
  SourcesState,
} from "./types.ts";

export type ReferenceKey = "tmdb" | "token" | "tvmaze" | "license" | "tvdb";

/**
 * Everything the interface can ask of the app. The desktop build implements it over IPC;
 * the browser preview implements it with example data. Queue changes arrive through
 * `onQueue`, including ones that finish after the call that started them returns.
 */
export interface MediaApi {
  /** False in the browser preview, where nothing touches real files. */
  readonly desktop: boolean;
  load(): Promise<{
    queue: QueueState;
    settings: AppSettings;
    sources: SourcesState;
  }>;
  onQueue(listener: (queue: QueueState) => void): void;
  addFiles(): Promise<void>;
  addFolder(): Promise<void>;
  /** Files or folders dropped onto the window. */
  addDropped(files: File[]): Promise<void>;
  search(key: string, request: SearchRequest): Promise<void>;
  choose(key: string, index: number): Promise<void>;
  confirm(key: string): Promise<void>;
  confirmSuggested(): Promise<void>;
  cancelLookups(): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  include(fileId: string): Promise<void>;
  exclude(fileId: string, excluded: boolean): Promise<void>;
  setEpisode(fileId: string, numbers: EpisodeNumbers): Promise<void>;
  /** For anime matched on Kitsu: whose seasons and episode numbers the new names use. */
  setNumbering(key: string, numbering: Catalogue): Promise<void>;
  /** Sets the order a group's file numbers are read in; null is the usual aired order. */
  setOrdering(key: string, id: string | null, keepNumbers: boolean): Promise<void>;
  /** Moves files to another group, or to a new one when `targetKey` is null; resolves to that group's key. */
  moveFiles(fileIds: string[], targetKey: string | null): Promise<string>;
  chooseDestination(): Promise<void>;
  resetDestination(): Promise<void>;
  preview(): Promise<PreviewState>;
  apply(
    planId: string,
  ): Promise<{ canceled?: boolean; completed?: number; warnings?: string[] }>;
  history(): Promise<BatchSummary[]>;
  undo(batchId: string): Promise<{ canceled?: boolean }>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  /** An empty token removes the stored one. */
  setToken(token: string): Promise<SourcesState>;
  /** An empty key removes the stored one. A wrong key is rejected with the reason. */
  setTvdbKey(key: string, pin: string): Promise<SourcesState>;
  openReference(key: ReferenceKey): Promise<void>;
}
