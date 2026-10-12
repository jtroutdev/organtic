<script setup lang="ts">
import { computed } from "vue";
import ActionButton from "../components/ActionButton.vue";
import DropZone from "../components/DropZone.vue";
import PageHeading from "../components/PageHeading.vue";
import { api, go, plural, run, store } from "../store.ts";

const fileCount = computed(() =>
  store.queue.groups.reduce((total, item) => total + item.files.length, 0),
);
// Matching opens on this page again if nothing was added.
async function add(action: () => Promise<unknown>) {
  await run(action);
  await go("review");
}
</script>

<template>
  <div class="page">
    <div class="above">
      <PageHeading title="Add files">
        <template v-if="store.queue.groups.length">
          {{ plural(fileCount, "file") }} in
          {{ plural(store.queue.groups.length, "group") }} already in the queue.
        </template>
        <template v-else>Nothing in the queue.</template>
      </PageHeading>
    </div>
    <DropZone>
      <h2>Drop a folder or files here</h2>
      <p class="muted">
        Video files are grouped by show or film and matched for you to confirm.
      </p>
      <div class="row">
        <ActionButton variant="primary" :disabled="store.busy" @click="add(api.addFolder)">
          Add folder
        </ActionButton>
        <ActionButton :disabled="store.busy" @click="add(api.addFiles)">Add files</ActionButton>
      </div>
    </DropZone>
  </div>
</template>
