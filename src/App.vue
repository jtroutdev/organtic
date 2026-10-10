<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { focusOn } from "./focus.ts";
import {
  api,
  apply,
  confirmAndNext,
  confirmed,
  go,
  init,
  run,
  store,
} from "./store.ts";
import type { Page } from "./store.ts";
import AddPage from "./pages/AddPage.vue";
import ReviewPage from "./pages/ReviewPage.vue";
import PreviewPage from "./pages/PreviewPage.vue";
import HistoryPage from "./pages/HistoryPage.vue";
import SettingsPage from "./pages/SettingsPage.vue";

const pages = {
  add: AddPage,
  review: ReviewPage,
  preview: PreviewPage,
  history: HistoryPage,
  settings: SettingsPage,
};
const LABELS: Record<Page, string> = {
  add: "Add files",
  review: "Matching",
  preview: "Preview",
  history: "History",
  settings: "Settings",
};
const KEYS: Page[] = ["review", "preview", "history", "settings"];
const tabs: Page[] = ["history", "settings"];
const empty = computed(
  () => !store.queue.groups.length && !store.queue.skipped.length,
);
// Matching has nothing to show for an empty queue, so it opens on adding files.
const view = computed<Page>(() =>
  store.page === "review" && empty.value ? "add" : store.page,
);
/** Where the wizard is, from 1 (adding files) to 4 (a batch applied). */
const at = computed(() => {
  const page =
    store.page === "history" || store.page === "settings" ? store.wizard : store.page;
  if (page === "preview") return store.applied ? 4 : 3;
  return page === "review" && !empty.value ? 2 : 1;
});
// A step can be opened from the stepper once the queue has what it needs.
const steps = computed<
  { page: Page | null; label: string; open: boolean; count: number | null; unit: string }[]
>(() => [
  { page: "add", label: "Add files", open: true, count: null, unit: "" },
  {
    page: "review",
    label: "Matching",
    open: !empty.value,
    count: store.queue.groups.length || null,
    unit: " groups in the queue",
  },
  {
    page: "preview",
    label: "Preview",
    open: confirmed().length > 0 && !store.applied,
    count: confirmed().length || null,
    unit: " groups confirmed",
  },
  { page: null, label: "Done", open: false, count: null, unit: "" },
]);
const mac = navigator.platform.toLowerCase().includes("mac");
const mod = mac ? "⌘" : "Ctrl";
const SHORTCUTS: [keys: string[], action: string][] = [
  [[`${mod}+1`, "…", `${mod}+4`], "Open Matching, Preview, History or Settings"],
  [["↑", "↓"], "Move through a list when it has focus"],
  [["Alt+↑", "Alt+↓"], "Previous or next item in the list, from anywhere"],
  [[`${mod}+Enter`], "Confirm and next on Matching; Apply on Preview"],
  [["/"], "Jump to the title search on Matching"],
  [[`${mod}+O`], "Add files"],
  [[`${mod}+Shift+O`], "Add folder"],
  [["Esc"], "Close an open form or clear the file selection"],
  [["?"], "Show this list"],
];

const dropping = ref(false);
async function drop(event: DragEvent) {
  dropping.value = false;
  const files = [...(event.dataTransfer?.files ?? [])];
  if (!files.length) return;
  await go("review");
  await run(() => api.addDropped(files));
}

const help = ref<HTMLDialogElement>();
/** Steps the selection in the current page's list without moving focus. */
function step(by: number) {
  const items = [...document.querySelectorAll<HTMLElement>(".side .item")];
  const at = items.findIndex((item) => item.getAttribute("aria-current") === "true");
  items[Math.min(Math.max(at + by, 0), items.length - 1)]?.click();
}
async function add(folder: boolean) {
  await go("review");
  await run(folder ? api.addFolder : api.addFiles);
}
function shortcut(event: KeyboardEvent) {
  // An open dialog keeps the keyboard to itself.
  if (document.querySelector("dialog[open]")) return;
  const target = event.target as HTMLElement;
  const typing =
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  const command = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  let handled = true;
  if (command && ["1", "2", "3", "4"].includes(key))
    void go(KEYS[Number(key) - 1]!);
  else if (command && key === "o") void add(event.shiftKey);
  else if (command && key === "enter") {
    if (store.page === "review") void confirmAndNext();
    else if (store.page === "preview" && api.desktop && !store.preview?.blocked)
      void apply();
  } else if (event.altKey && key === "arrowdown") step(1);
  else if (event.altKey && key === "arrowup") step(-1);
  else if (!typing && !command && !event.altKey && key === "/")
    void focusOn("#search-title");
  else if (!typing && !command && !event.altKey && event.key === "?")
    help.value?.showModal();
  else handled = false;
  if (handled) event.preventDefault();
}
onMounted(() => {
  window.addEventListener("keydown", shortcut);
  void init();
});
onUnmounted(() => window.removeEventListener("keydown", shortcut));

// A new page is announced by its heading taking focus, as a page load would.
watch(
  () => store.visits,
  async () => {
    document.title = `${LABELS[view.value]} · Organtic`;
    await nextTick();
    const heading = document.querySelector<HTMLElement>("main h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus();
  },
);
</script>

<template>
  <a class="skip" href="#content" @click.prevent="focusOn('#content')"
    >Skip to content</a
  >
  <div
    class="wrap"
    :class="{ dropping }"
    @dragover.prevent="dropping = true"
    @dragleave="dropping = false"
    @drop.prevent="drop"
  >
    <header class="top">
      <div class="brand">
        Organtic<small v-if="!api.desktop">Example mode</small>
      </div>
      <nav class="steps" aria-label="Progress">
        <ol>
          <template v-for="(step, index) in steps" :key="step.label">
            <li v-if="index" class="join" aria-hidden="true"></li>
            <li>
              <component
                :is="step.open && index + 1 !== at ? 'button' : 'span'"
                class="step"
                :class="{ done: index + 1 < at }"
                :type="step.open && index + 1 !== at ? 'button' : undefined"
                :aria-current="index + 1 === at ? 'step' : undefined"
                @click="step.open && step.page && index + 1 !== at && go(step.page)"
              >
                <span class="badge">
                  <svg
                    v-if="index + 1 < at"
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                  <template v-else>{{ index + 1 }}</template>
                </span>
                <span class="sr-only">{{ index + 1 < at ? "Finished: " : "" }}</span
                >{{ step.label
                }}<span v-if="step.count !== null" class="n"
                  >{{ step.count }}<span class="sr-only">{{ step.unit }}</span></span
                >
              </component>
            </li>
          </template>
        </ol>
      </nav>
      <nav class="tabs" aria-label="Main">
        <button
          v-for="(id, index) in tabs"
          :key="id"
          type="button"
          :aria-current="store.page === id ? 'page' : undefined"
          :aria-keyshortcuts="`Control+${index + 3}`"
          @click="go(id)"
        >
          {{ LABELS[id] }}
        </button>
        <button type="button" aria-haspopup="dialog" @click="help?.showModal()">
          Shortcuts
        </button>
      </nav>
    </header>
    <main id="content" tabindex="-1">
      <div class="notices">
        <div v-if="!api.desktop" class="banner ask">
          <span
            >This browser preview uses example files and a canned catalogue. Open
            the desktop app to work with your own files.</span
          >
        </div>
        <div v-if="store.error" class="banner bad" role="alert">
          <span>{{ store.error }}</span>
          <button class="btn" type="button" @click="store.error = ''">
            Dismiss
          </button>
        </div>
      </div>
      <component :is="pages[view]" />
    </main>
  </div>
  <p class="sr-only" role="status" aria-live="polite">{{ store.notice }}</p>
  <dialog ref="help" class="help" aria-labelledby="help-title">
    <h2 id="help-title">Keyboard shortcuts</h2>
    <dl>
      <template v-for="[keys, action] in SHORTCUTS" :key="action">
        <dt>
          <template v-for="key in keys" :key="key"
            ><kbd v-if="key !== '…'">{{ key }}</kbd
            ><span v-else aria-hidden="true"> … </span></template
          >
        </dt>
        <dd>{{ action }}</dd>
      </template>
    </dl>
    <form method="dialog">
      <button class="btn primary" type="submit">Close</button>
    </form>
  </dialog>
</template>
