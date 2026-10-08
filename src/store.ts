import { reactive } from "vue";
import type { MediaApi } from "../core/api.ts";
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

export type Page = "review" | "preview" | "history" | "settings";
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
  queue: {
    groups: [],
    skipped: [],
    destination: "",
    destinationChanged: false,
    lookups: null,
  } as QueueState,
  settings: DEFAULT_SETTINGS as AppSettings,
  sources: { tmdb: "none", tvdb: "none", canSave: false } as SourcesState,
  filter: "all" as Filter,
  selected: null as string | null,
  preview: null as PreviewState | null,
  previewSelected: null as string | null,
  applied: null as {
    completed: number;
    destination: string;
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

async function loadPreview() {
  if (!confirmed().length) {
    store.preview = null;
    return;
  }
  try {
    store.preview = await api.preview();
  } catch (error) {
    store.preview = null;
    store.error = error instanceof Error ? error.message : String(error);
  }
}

export async function loadHistory() {
  store.batches = (await run(() => api.history())) ?? [];
}

export async function go(page: Page) {
  store.page = page;
  store.error = "";
  if (page !== "preview") store.applied = null;
  if (page === "preview") await loadPreview();
  if (page === "history") await loadHistory();
  store.visits++;
}

export async function saveSettings(change: Partial<AppSettings>) {
  const saved = await run(() =>
    api.saveSettings({ ...store.settings, ...change }),
  );
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
  store.applied = {
    completed: result.completed ?? 0,
    destination: preview.destination,
    warnings: result.warnings ?? [],
  };
  store.preview = null;
}

export async function init() {
  api.onQueue((queue) => {
    if (queue.lookups && !store.queue.lookups)
      announce(`Looking up ${plural(queue.lookups.total, "group")}.`);
    if (!queue.lookups && store.queue.lookups) announce("Lookups finished.");
    store.queue = queue;
    // What is on screen in Preview must always match the queue it was built from.
    if (store.page === "preview" && !store.applied) void loadPreview();
  });
  const loaded = await run(() => api.load());
  if (!loaded) return;
  store.queue = loaded.queue;
  store.settings = loaded.settings;
  store.sources = loaded.sources;
}
