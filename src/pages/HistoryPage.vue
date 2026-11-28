<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { BatchChange, BatchStatus, ChangeOutcome } from "../../core/types.ts";
import ActionButton from "../components/ActionButton.vue";
import ChangeRow from "../components/ChangeRow.vue";
import ListItem from "../components/ListItem.vue";
import NoticeBanner from "../components/NoticeBanner.vue";
import PageHeading from "../components/PageHeading.vue";
import SegmentedSet from "../components/SegmentedSet.vue";
import SplitView from "../components/SplitView.vue";
import StatusPill from "../components/StatusPill.vue";
import SurfaceCard from "../components/SurfaceCard.vue";
import { focusOn } from "../focus.ts";
import {
  announce,
  api,
  loadHistory,
  plural,
  resume,
  resumeLabel,
  run,
  showBatch,
  stop,
  store,
} from "../store.ts";

const STATUS: Record<BatchStatus, [tone: string, label: string]> = {
  complete: ["ok", "Complete"],
  interrupted: ["warn", "Interrupted"],
  undone: ["off", "Undone"],
  damaged: ["bad", "Unreadable"],
};
const batch = computed(
  () =>
    store.batches.find((item) => item.id === store.batchSelected) ??
    store.batches[0],
);
// Paths are shown from the folder the whole batch happened in, which is named once.
const root = computed(() => batch.value?.root ?? "");
/** The selected batch's changes, or null while they load. */
const changes = computed(() =>
  store.changesOf === batch.value?.id ? store.changes : null,
);
// Rows that stand in while the changes load: as many as there will be, up to a screenful.
const LOADING = 8;
/** How many changes are listed at first, and how many more each press adds. */
const PAGE = 200;
const MORE = 500;
const FILTERS = [
  ["all", "All", "Every change the batch planned"],
  ["problems", "Problems", "Failed, skipped and not started"],
] as const;
const filter = ref<"all" | "problems">("all");
const shown = ref(PAGE);
/** The changes the filter keeps, and the ones listed so far. */
const listed = computed(() =>
  (changes.value ?? []).filter(
    (op) => filter.value === "all" || op.outcome !== "done",
  ),
);
const visible = computed(() => listed.value.slice(0, shown.value));
const step = computed(() => Math.min(MORE, listed.value.length - shown.value));
// A different batch, or a different filter, starts from the top again.
watch([() => batch.value?.id, filter], () => (shown.value = PAGE));
async function showMore() {
  shown.value += MORE;
  announce(`Showing ${visible.value.length} of ${plural(listed.value.length, "change")}.`);
  // The button pressed is gone once everything is listed: focus goes to the list.
  if (shown.value >= listed.value.length) await focusOn(".scroll");
}
const short = (path: string) =>
  root.value && path.startsWith(root.value) ? path.slice(root.value.length) : path;
/** A message with its paths shortened the same way. */
const within = (message: string) =>
  root.value ? message.replaceAll(root.value, "") : message;
const KINDS = {
  mkdir: "new folder",
  rmdir: "removed empty folder",
  download: "downloaded artwork",
};
const OUTCOME: Record<ChangeOutcome, [tone: string, label: string]> = {
  done: ["ok", "Done"],
  failed: ["bad", "Failed"],
  skipped: ["warn", "Skipped"],
  pending: ["off", "Not started"],
};
// A batch where everything went through has nothing to tell apart, so its rows stay plain.
const mixed = computed(() =>
  Object.entries(batch.value?.outcomes ?? {}).some(([outcome, count]) => outcome !== "done" && count),
);
const tally = computed(() => {
  const counts = batch.value?.outcomes ?? {};
  return (["done", "failed", "skipped", "pending"] as const)
    .filter((outcome) => counts[outcome])
    .map((outcome) => `${counts[outcome]} ${OUTCOME[outcome][1].toLowerCase()}`)
    .join(", ");
});
// The reason is given once, in the banner; the row that failed carries it only if it differs.
const reasonOf = (op: BatchChange) =>
  op.message && op.message !== batch.value?.stopped ? within(op.message) : undefined;
const when = (value: string) =>
  value ? new Date(value).toLocaleString() : "Unreadable record";
// The undo running now, once it has started.
const undoing = computed(() => (store.progress?.kind === "undo" ? store.progress : null));
async function undo(id: string) {
  let result;
  try {
    result = await run(() => api.undo(id));
  } finally {
    store.progress = null;
  }
  await loadHistory();
  if (result && !result.canceled) announce("Batch undone.");
}
async function remove(id: string) {
  const result = await run(() => api.removeBatch(id));
  if (!result || result.canceled) return;
  await loadHistory();
  announce("Batch removed from History.");
  // The button pressed is gone: focus goes to the batch now selected, or the page.
  await focusOn(store.batches.length ? '.item[aria-current="true"]' : "#content");
}
</script>

<template>
  <div class="page">
    <div class="above">
      <PageHeading title="History">
        Every batch is recorded so it can be put back.
        <template #actions>
          <div class="row">
            <ActionButton :disabled="store.busy" @click="loadHistory">Refresh</ActionButton>
            <ActionButton @click="resume">Back to {{ resumeLabel() }}</ActionButton>
          </div>
        </template>
      </PageHeading>
    </div>
    <SurfaceCard v-if="!batch">
      <p>No batches yet. Applied changes will be listed here.</p>
    </SurfaceCard>
    <SplitView v-else :current="batch.id" list="Batches" detail="Selected batch">
      <template #side>
        <ListItem
          v-for="item in store.batches"
          :key="item.id"
          :current="item.id === batch.id"
          :tone="STATUS[item.status][0]"
          :note="STATUS[item.status][1]"
          :count="item.count"
          unit="operations"
          @click="showBatch(item.id)"
        >
          {{ when(item.createdAt) }}
        </ListItem>
      </template>
      <div class="row between">
        <h2 class="title">{{ when(batch.createdAt) }}</h2>
        <StatusPill :tone="STATUS[batch.status][0]">{{ STATUS[batch.status][1] }}</StatusPill>
      </div>
      <p class="muted">
        {{ batch.count }} operations<template v-if="root">
          in <span class="mono">{{ root }}</span></template
        >
      </p>
      <NoticeBanner v-if="batch.status === 'interrupted'" tone="bad"
        ><b v-if="batch.stopped">{{ within(batch.stopped).replace(/[^.!?]$/, "$&.") }}</b> This batch
        stopped before it finished: {{ tally }}. Undo puts back what was
        done.</NoticeBanner
      >
      <NoticeBanner v-if="batch.status === 'damaged'" tone="bad"
        >This record could not be read, so the batch cannot be undone from
        here.</NoticeBanner
      >
      <div v-if="batch.count" class="fill">
        <div class="head">
          <h3 class="label">What changed</h3>
          <SegmentedSet
            v-if="mixed"
            v-model="filter"
            label="Which changes to list"
            :options="FILTERS"
          />
        </div>
        <div v-if="!changes" class="scroll" aria-busy="true">
          <ChangeRow v-for="index in Math.min(batch.count, LOADING)" :key="index" />
        </div>
        <div v-else class="scroll" tabindex="-1">
          <template v-for="(op, index) in visible" :key="index">
            <ChangeRow
              v-if="op.type === 'move' || op.type === 'rename'"
              :before="short(op.source ?? '')"
              :before-tip="op.source"
              :after="short(op.target)"
              :after-tip="op.target"
              :outcome="mixed ? OUTCOME[op.outcome] : undefined"
              :reason="reasonOf(op)"
              renamed
            />
            <ChangeRow
              v-else
              :before="KINDS[op.type as keyof typeof KINDS] ?? 'new metadata file'"
              :after="short(op.target)"
              :after-tip="op.target"
              :outcome="mixed ? OUTCOME[op.outcome] : undefined"
              :reason="reasonOf(op)"
            />
          </template>
          <p v-if="!listed.length" class="muted more">
            Every change in this batch went through.
          </p>
          <div v-else-if="listed.length > visible.length" class="more">
            <ActionButton @click="showMore">Show {{ step }} more</ActionButton>
            <span class="muted"
              >{{ visible.length }} of {{ plural(listed.length, "change") }} shown</span
            >
          </div>
        </div>
      </div>
      <div class="actions">
        <div class="row">
          <span v-if="batch.status === 'undone'" class="muted"
            >The original names were restored.</span
          >
          <template v-else-if="batch.status !== 'damaged'">
            <ActionButton variant="primary" :disabled="store.busy" @click="undo(batch.id)">
              {{
                batch.status === "interrupted"
                  ? "Put the moved files back"
                  : "Undo this batch"
              }}
            </ActionButton>
            <template v-if="undoing">
              <span class="muted"
                >Putting back: {{ undoing.done }} of
                {{ plural(undoing.total, "operation") }} done</span
              >
              <ActionButton @click="stop">Stop</ActionButton>
            </template>
            <span v-else class="muted"
              >Stops without changing anything further if a file was edited or its
              old name is taken.</span
            >
          </template>
        </div>
        <ActionButton
          v-if="batch.status === 'complete' || batch.status === 'undone'"
          variant="quiet"
          :disabled="store.busy || !!undoing"
          @click="remove(batch.id)"
          >Remove from History</ActionButton
        >
      </div>
    </SplitView>
  </div>
</template>

<style scoped>
/* The heading and the filter share a line, the filter against the right edge. */
.head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-nested);align-items:center}
.more{display:flex;flex-wrap:wrap;gap:var(--space-nested);align-items:center;padding-top:var(--space-nested)}
.scroll:focus-visible{outline:2px solid var(--color-accent);outline-offset:-2px}
/* Removing sits apart on the right, level with Undo, however the words beside Undo wrap. */
.actions{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-nested);align-items:start}
</style>
