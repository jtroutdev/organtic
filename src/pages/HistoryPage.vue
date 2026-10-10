<script setup lang="ts">
import { computed } from "vue";
import type { BatchStatus } from "../../core/types.ts";
import ListItem from "../components/ListItem.vue";
import SplitView from "../components/SplitView.vue";
import { announce, api, loadHistory, run, store } from "../store.ts";

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
      <div class="head">
        <div>
          <h1>History</h1>
          <p>Every batch is recorded so it can be put back.</p>
        </div>
        <button class="btn" type="button" :disabled="store.busy" @click="loadHistory">
          Refresh
        </button>
      </div>
    </div>
    <div v-if="!batch" class="card">
      <p>No batches yet. Applied changes will be listed here.</p>
    </div>
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
        <span class="pill" :class="STATUS[batch.status][0]">{{
          STATUS[batch.status][1]
        }}</span>
      </div>
      <p class="muted">{{ batch.count }} operations</p>
      <div v-if="batch.status === 'interrupted'" class="banner bad">
        <span
          >This batch stopped before it finished. Some files have their new
          names and some do not. Undo puts the renamed ones back.</span
        >
      </div>
      <div v-if="batch.status === 'damaged'" class="banner bad">
        <span
          >This record could not be read, so the batch cannot be undone from
          here.</span
        >
      </div>
      <div v-if="batch.operations.length" class="fill">
        <h3 class="label">What changed</h3>
        <div class="scroll">
          <div
            v-for="(op, index) in batch.operations.slice(0, LIMIT)"
            :key="index"
            class="mono"
            style="padding: 6px 0; border-bottom: 1px solid var(--line)"
          >
            <template v-if="op.type === 'move' || op.type === 'rename'"
              ><span class="muted">{{ op.source }}</span> → {{ op.target }}</template
            >
            <template v-else
              ><span class="muted">{{
                op.type === "mkdir"
                  ? "new folder"
                  : op.type === "rmdir"
                    ? "removed empty folder"
                    : op.type === "download"
                      ? "downloaded artwork"
                      : "new metadata file"
              }}</span>
              {{ op.target }}</template
            >
          </div>
          <p v-if="batch.operations.length > LIMIT" class="muted" style="padding-top: 6px">
            and {{ batch.operations.length - LIMIT }} more
          </p>
        </div>
      </div>
      <div class="row">
        <span v-if="batch.status === 'undone'" class="muted"
          >The original names were restored.</span
        >
        <template v-else-if="batch.status !== 'damaged'">
          <button
            class="btn primary"
            type="button"
            :disabled="store.busy"
            @click="undo(batch.id)"
          >
            {{
              batch.status === "interrupted"
                ? "Put the moved files back"
                : "Undo this batch"
            }}
          </button>
          <span class="muted"
            >Stops without changing anything further if a file was edited or its
            old name is taken.</span
          >
        </template>
      </div>
    </SplitView>
  </div>
</template>
