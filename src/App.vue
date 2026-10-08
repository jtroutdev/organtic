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
import ReviewPage from "./pages/ReviewPage.vue";
import PreviewPage from "./pages/PreviewPage.vue";
import HistoryPage from "./pages/HistoryPage.vue";
import SettingsPage from "./pages/SettingsPage.vue";

const pages = {
  review: ReviewPage,
  preview: PreviewPage,
  history: HistoryPage,
  settings: SettingsPage,
};
const tabs = computed<[Page, string, number | null][]>(() => [
  ["review", "Review", store.queue.groups.length || null],
  ["preview", "Preview", confirmed().length || null],
  ["history", "History", null],
  ["settings", "Settings", null],
]);
const mac = navigator.platform.toLowerCase().includes("mac");
const mod = mac ? "⌘" : "Ctrl";
const SHORTCUTS: [keys: string[], action: string][] = [
  [[`${mod}+1`, "…", `${mod}+4`], "Open Review, Preview, History or Settings"],
  [["↑", "↓"], "Move through a list when it has focus"],
  [["Alt+↑", "Alt+↓"], "Previous or next item in the list, from anywhere"],
  [[`${mod}+Enter`], "Confirm and next on Review; Apply on Preview"],
  [["/"], "Jump to the title search on Review"],
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
  if (help.value?.open) return;
  const target = event.target as HTMLElement;
  const typing =
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  const command = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  let handled = true;
  if (command && ["1", "2", "3", "4"].includes(key))
    void go(tabs.value[Number(key) - 1]![0]);
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
    const label = tabs.value.find(([id]) => id === store.page)![1];
    document.title = `${label} · Organtic`;
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
      <div class="row">
        <nav class="tabs" aria-label="Main">
          <button
            v-for="([id, label, count], index) in tabs"
            :key="id"
            type="button"
            :aria-current="store.page === id ? 'page' : undefined"
            :aria-keyshortcuts="`Control+${index + 1}`"
            @click="go(id)"
          >
            {{ label
            }}<span v-if="count !== null"
              >{{ count
              }}<span class="sr-only">{{
                id === "review" ? " groups in the queue" : " groups confirmed"
              }}</span></span
            >
          </button>
        </nav>
        <button
          class="btn quiet"
          type="button"
          aria-haspopup="dialog"
          @click="help?.showModal()"
        >
          Shortcuts
        </button>
      </div>
    </header>
    <main id="content" tabindex="-1">
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
      <component :is="pages[store.page]" />
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
