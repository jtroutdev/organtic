<script setup lang="ts">
import { computed } from "vue";
import { commonFolder } from "../../core/paths.ts";
import type { BatchStatus } from "../../core/types.ts";
import ActionButton from "../components/ActionButton.vue";
import ChangeRow from "../components/ChangeRow.vue";
import ListItem from "../components/ListItem.vue";
import NoticeBanner from "../components/NoticeBanner.vue";
import PageHeading from "../components/PageHeading.vue";
import SplitView from "../components/SplitView.vue";
import StatusPill from "../components/StatusPill.vue";
import SurfaceCard from "../components/SurfaceCard.vue";
import { announce, api, loadHistory, resume, resumeLabel, run, store } from "../store.ts";

const STATUS: Record<BatchStatus, [tone: string, label: string]> = {
  complete: ["ok", "Complete"],
  interrupted: ["warn", "Interrupted"],
  undone: ["off", "Undone"],
  damaged: ["bad", "Unreadable"],
};
const LIMIT = 200;
const batch = computed(
  () =>
    store.batches.find((item) => item.id === store.batchSelected) ??
    store.batches[0],
);
// Paths are shown from the folder the whole batch happened in, which is named once.
const root = computed(() =>
  commonFolder(
    (batch.value?.operations ?? []).flatMap((op) =>
      op.source ? [op.source, op.target] : [op.target],
    ),
  ),
);
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
type Change = (typeof store.batches)[number]["operations"][number];
const OUTCOME: Record<Change["outcome"], [tone: string, label: string]> = {
  done: ["ok", "Done"],
  failed: ["bad", "Failed"],
  skipped: ["warn", "Skipped"],
  pending: ["off", "Not started"],
};
// A batch where everything went through has nothing to tell apart, so its rows stay plain.
const mixed = computed(
  () => batch.value?.operations.some((op) => op.outcome !== "done") ?? false,
);
const tally = computed(() => {
  const counts = Object.groupBy(batch.value?.operations ?? [], (op) => op.outcome);
  return (["done", "failed", "skipped", "pending"] as const)
    .filter((outcome) => counts[outcome]?.length)
    .map((outcome) => `${counts[outcome]!.length} ${OUTCOME[outcome][1].toLowerCase()}`)
    .join(", ");
});
// The reason is given once, in the banner; the row that failed carries it only if it differs.
const reasonOf = (op: Change) =>
  op.message && op.message !== batch.value?.stopped ? within(op.message) : undefined;
const when = (value: string) =>
  value ? new Date(value).toLocaleString() : "Unreadable record";
async function undo(id: string) {
  const result = await run(() => api.undo(id));
  await loadHistory();
  if (result && !result.canceled) announce("Batch undone.");
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
          @click="store.batchSelected = item.id"
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
      <div v-if="batch.operations.length" class="fill">
        <h3 class="label">What changed</h3>
        <div class="scroll">
          <template v-for="(op, index) in batch.operations.slice(0, LIMIT)" :key="index">
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
          <p v-if="batch.operations.length > LIMIT" class="muted more">
            and {{ batch.operations.length - LIMIT }} more
          </p>
        </div>
      </div>
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
          <span class="muted"
            >Stops without changing anything further if a file was edited or its
            old name is taken.</span
          >
        </template>
      </div>
    </SplitView>
  </div>
</template>

<style scoped>
.more{padding-top:var(--space-dense)}
</style>
