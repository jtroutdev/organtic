<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { focusOn } from "./focus.ts";
import {
  api,
  apply,
  canPreview,
  confirmAndNext,
  confirmed,
  go,
  init,
  run,
  store,
} from "./store.ts";
import type { Page } from "./store.ts";
import ActionButton from "./components/ActionButton.vue";
import AppDialog from "./components/AppDialog.vue";
import NavTab from "./components/NavTab.vue";
import NoticeBanner from "./components/NoticeBanner.vue";
import WizardSteps from "./components/WizardSteps.vue";
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
  () =>
    !store.queue.groups.length &&
    !store.queue.skipped.length &&
    !store.queue.unread.length,
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
  { id: Page | null; label: string; open: boolean; count: number | null; unit: string }[]
>(() => [
  { id: "add", label: "Add files", open: true, count: null, unit: "" },
  {
    id: "review",
    label: "Matching",
    open: !empty.value,
    count: store.queue.groups.length || null,
    unit: " groups in the queue",
  },
  {
    id: "preview",
    label: "Preview",
    open: canPreview() && !store.applied,
    count: confirmed().length || null,
    unit: " groups confirmed",
  },
  { id: null, label: "Done", open: false, count: null, unit: "" },
]);
const mac = navigator.platform.toLowerCase().includes("mac");
const mod = mac ? "⌘" : "Ctrl";
const SHORTCUTS: [keys: string[], action: string][] = [
  [[`${mod}+1`, "…", `${mod}+4`], "Open Matching, Preview, History or Settings"],
  [["↑", "↓"], "Move through a list when it has focus"],
  [["Alt+↑", "Alt+↓"], "Previous or next item in the list, from anywhere"],
  [[`${mod}+Enter`], "Confirm and next on Matching; Apply on Preview"],
  [["F8", "Shift+F8"], "Next or previous problem in the group's files on Matching"],
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

const help = ref<InstanceType<typeof AppDialog>>();
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
  if (command && ["1", "2", "3", "4"].includes(key)) {
    const page = KEYS[Number(key) - 1]!;
    if (page !== "preview" || canPreview()) void go(page);
  } else if (key === "f8")
    // The buttons live on Matching, so this does nothing elsewhere.
    document
      .querySelector<HTMLElement>(`.problems [data-step="${event.shiftKey ? -1 : 1}"]`)
      ?.click();
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
    help.value?.open();
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
    :class="{ dropping, working: store.busy }"
    @dragover.prevent="dropping = true"
    @dragleave="dropping = false"
    @drop.prevent="drop"
  >
    <header class="top">
      <div class="brand">
        Organtic<small v-if="!api.desktop">Example mode</small>
      </div>
      <WizardSteps :steps="steps" :at="at" :away="store.page !== store.wizard" @go="go" />
      <nav class="tabs" aria-label="Main">
        <NavTab
          v-for="(id, index) in tabs"
          :key="id"
          :current="store.page === id"
          :aria-keyshortcuts="`Control+${index + 3}`"
          @click="go(id)"
        >
          {{ LABELS[id] }}
        </NavTab>
        <NavTab aria-haspopup="dialog" @click="help?.open()">Shortcuts</NavTab>
      </nav>
    </header>
    <main id="content" tabindex="-1">
      <div class="notices">
        <NoticeBanner v-if="!api.desktop" tone="ask"
          >This browser preview uses example files and a canned catalogue. Open
          the desktop app to work with your own files.</NoticeBanner
        >
        <NoticeBanner v-if="store.error" tone="bad" role="alert"
          >{{ store.error
          }}<template #action>
            <ActionButton @click="store.error = ''">Dismiss</ActionButton>
          </template>
        </NoticeBanner>
      </div>
      <component :is="pages[view]" />
    </main>
  </div>
  <p class="sr-only" role="status" aria-live="polite">{{ store.notice }}</p>
  <AppDialog ref="help" labelledby="help-title">
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
      <ActionButton variant="primary" type="submit">Close</ActionButton>
    </form>
  </AppDialog>
</template>

<style scoped>
/* The header, then the page. The window never scrolls: grid rows pin everything in place. */
.wrap{height:100dvh;display:grid;grid-template:auto minmax(0,1fr)/minmax(0,1fr)}
.dropping{outline:2px dashed var(--color-accent);outline-offset:calc(-1 * var(--space-xs))}
.top{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--space-nested) var(--space-page);align-items:center;border-bottom:1px solid var(--color-outline-subtle);padding:var(--space-nested) var(--space-page)}
.brand{display:flex;align-items:baseline;gap:var(--space-nested);font:var(--font-headline-md);letter-spacing:-.01em}
.brand small{font:var(--font-label-sm);color:var(--color-on-surface-muted);letter-spacing:var(--tracking-label);text-transform:uppercase}
.steps{justify-self:center}
.tabs{display:flex;flex-wrap:wrap;gap:var(--space-dense)}
/* Notices, then the page: what sits above the split, the split filling what is left, and anything
   below it. */
main{position:relative;display:grid;grid-template:auto minmax(0,1fr)/minmax(0,1fr);gap:var(--space-page);overflow:hidden;min-width:0;padding:var(--space-page)}
main:focus{outline:none}
/* With no notice to show, the page is the only row. */
main:has(>.notices:empty){grid-template-rows:minmax(0,1fr)}
.notices{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-surface)}
.notices:empty{display:none}
.skip{position:absolute;left:var(--space-page);top:calc(-2 * var(--size-control));background:var(--color-primary);color:var(--color-on-primary);padding:var(--space-sm) var(--space-md);border-radius:var(--radius-md);font-weight:600;z-index:var(--z-skip)}
.skip:focus{top:var(--space-nested)}
/* Too narrow for one line: the steps take a line of their own under the name and the tabs. */
@media (max-width:1040px){
  .top{grid-template-columns:minmax(0,1fr) auto}
  .steps{grid-area:2/1/auto/-1;justify-self:start}
}
</style>
