import { reactive } from "vue";
import type { AboutState, MediaApi } from "../core/api.ts";
import { applyQueueUpdate } from "../core/queueUpdate.ts";
import { DEFAULT_SETTINGS } from "../core/settings.ts";
import type {
  AppSettings,
  BatchSummary,
  GroupStatus,
  PreviewState,
  QueueGroup,
  QueueState,
  SourcesState,
} from "../core/types.ts";
import { demoApi } from "./demo.ts";

export const api: MediaApi = window.organtic ?? demoApi;

export type Page = "add" | "review" | "preview" | "history" | "settings";
export type Filter = "all" | "todo" | "confirmed";

/** Pill colour and wording for each state a group can be in. */
export const STATUS: Record<GroupStatus, [tone: string, label: string]> = {
  matching: ["off busy", "Looking up"],
  suggested: ["sug", "Suggested"],
  review: ["warn", "Check this match"],
  unmatched: ["bad", "Choose a match"],
  confirmed: ["ok", "Confirmed"],
};

export const store = reactive({
  page: "review" as Page,
  /** The wizard page last shown, which the stepper keeps marking from History and Settings. */
  wizard: "review" as "add" | "review" | "preview",
  queue: {
    groups: [],
    skipped: [],
    unread: [],
    lookups: null,
  } as QueueState,
  settings: DEFAULT_SETTINGS as AppSettings,
  sources: { tmdb: "none", tvdb: "none", canSave: false } as SourcesState,
  about: { version: "", logFile: null } as AboutState,
  /** Something from start-up the person should know, such as settings that could not be read. */
  startNotice: "",
  filter: "all" as Filter,
  selected: null as string | null,
  preview: null as PreviewState | null,
  /** A preview is being built. With none to show yet, the page draws its outline instead. */
  previewLoading: false,
  previewSelected: null as string | null,
  applied: null as {
    completed: number;
    /** The folders the batch organised into, one unless groups were sent to different ones. */
    destinations: string[];
    warnings: string[];
  } | null,
  batches: [] as BatchSummary[],
  batchSelected: null as string | null,
  section: "naming",
  error: "",
  /** The latest outcome, read out by screen readers without moving focus. */
  notice: "",
  /** Counts completed page changes, so focus can move once the new page has its content. */
  visits: 0,
  busy: false,
});

export function announce(message: string) {
  // Cleared first so repeating the same message is still read out.
  store.notice = "";
  queueMicrotask(() => (store.notice = message));
}

export const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;
export const confirmed = () =>
  store.queue.groups.filter((group) => group.status === "confirmed");
/** Groups still waiting on the user. Preview opens once every group is confirmed or removed. */
export const unconfirmed = () =>
  store.queue.groups.filter((group) => group.status !== "confirmed").length;
export const canPreview = () => confirmed().length > 0 && !unconfirmed();
export const filtered = (): QueueGroup[] =>
  store.queue.groups.filter((group) =>
    store.filter === "todo"
      ? group.status !== "confirmed"
      : store.filter === "confirmed"
        ? group.status === "confirmed"
        : true,
  );

/** The group shown on Review: the selected one, or the first in the current filter. */
export function currentGroup(): QueueGroup | undefined {
  const groups = filtered();
  return groups.find((group) => group.key === store.selected) ?? groups[0];
}
export const nameOf = (group: QueueGroup) => {
  const chosen = group.chosen == null ? null : group.candidates[group.chosen];
  return chosen
    ? `${chosen.title} (${chosen.year ?? "year unknown"})`
    : group.parsedTitle || "Unnamed";
};
/** Selects the next group still needing attention after `from`, wrapping round. */
export function selectNext(from: string) {
  const all = store.queue.groups;
  const index = all.findIndex((group) => group.key === from);
  const rest = [...all.slice(index + 1), ...all.slice(0, index)];
  store.selected =
    (rest.find((group) => group.status !== "confirmed") ?? rest[0])?.key ?? null;
}
export async function confirmAndNext() {
  const group = currentGroup();
  if (
    !group ||
    group.chosen == null ||
    group.status === "matching" ||
    group.status === "confirmed"
  )
    return;
  await run(() => api.confirm(group.key));
  announce(`Confirmed ${nameOf(group)}.`);
  selectNext(group.key);
}

/** Runs one user action: shows it as busy and turns a failure into a message on screen. */
export async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
  store.busy = true;
  store.error = "";
  try {
    return await action();
  } catch (error) {
    store.error = (error instanceof Error ? error.message : String(error)).replace(
      /^Error invoking remote method '[^']+': (?:Error: )?/,
      "",
    );
    return undefined;
  } finally {
    store.busy = false;
  }
}

/**
 * The preview being built. One is built at a time: a change to the queue while it is on its
 * way asks for one more once it is back, however many changes there were.
 */
let loading: Promise<void> | null = null;
let again = false;
async function buildPreview() {
  store.previewLoading = true;
  try {
    do {
      again = false;
      if (!confirmed().length) {
        store.preview = null;
        continue;
      }
      try {
        store.preview = await api.preview();
      } catch (error) {
        store.preview = null;
        store.error = error instanceof Error ? error.message : String(error);
      }
    } while (again);
  } finally {
    store.previewLoading = false;
  }
}
async function loadPreview() {
  if (loading) {
    again = true;
    return loading;
  }
  loading = buildPreview();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

export async function loadHistory() {
  store.batches = (await run(() => api.history())) ?? [];
}

export async function go(page: Page) {
  store.page = page;
  store.error = "";
  // Leaving the result of a batch starts the next one from the queue.
  if (page !== "preview" && store.applied) store.wizard = "review";
  if (page !== "preview") store.applied = null;
  if (page === "add" || page === "review" || page === "preview") store.wizard = page;
  if (page === "preview") await loadPreview();
  if (page === "history") await loadHistory();
  store.visits++;
}

/** Back to the wizard step that was on screen before History or Settings. */
export const resume = () => go(store.wizard);
/** That step, by the name the stepper gives it. */
export const resumeLabel = () =>
  store.wizard === "preview"
    ? "Preview"
    : store.queue.groups.length || store.queue.skipped.length
      ? "Matching"
      : "Add files";

export async function saveSettings(change: Partial<AppSettings>) {
  // A plain copy: the desktop bridge cannot pass the reactive proxy around the nested templates.
  const settings: AppSettings = JSON.parse(
    JSON.stringify({ ...store.settings, ...change }),
  );
  const saved = await run(() => api.saveSettings(settings));
  if (saved) {
    store.settings = saved;
    announce("Settings saved.");
  }
  return !!saved;
}

export async function apply() {
  const preview = store.preview;
  if (!preview) return;
  const result = await run(() => api.apply(preview.id));
  if (!result) return void loadPreview();
  if (result.canceled) return;
  announce(`${result.completed ?? 0} changes applied.`);
  const destinations = [...new Set(preview.groups.map((group) => group.destination))];
  store.applied = {
    completed: result.completed ?? 0,
    destinations,
    warnings: result.warnings ?? [],
  };
  store.preview = null;
}

export async function init() {
  api.onQueue((update) => {
    if (update.lookups && !store.queue.lookups)
      announce(`Looking up ${plural(update.lookups.total, "group")}.`);
    if (!update.lookups && store.queue.lookups) announce("Lookups finished.");
    // What is on screen in Preview must always match the queue it was built from. It is built
    // from confirmed groups only, so it is built again when one is added, changed or removed,
    // not for a lookup elsewhere in the queue.
    const shown = new Set(confirmed().map((group) => group.key));
    const affects =
      !!update.order ||
      update.groups.some((group) => group.status === "confirmed" || shown.has(group.key));
    applyQueueUpdate(store.queue, update);
    if (affects && store.page === "preview" && !store.applied) void loadPreview();
  });
  const loaded = await run(() => api.load());
  if (!loaded) return;
  store.queue = loaded.queue;
  store.settings = loaded.settings;
  store.sources = loaded.sources;
  store.about = loaded.about;
  store.startNotice = loaded.notice ?? "";
}
