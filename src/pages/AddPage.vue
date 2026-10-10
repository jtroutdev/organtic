<script setup lang="ts">
import { computed } from "vue";
import { api, go, plural, run, store } from "../store.ts";

const fileCount = computed(() =>
  store.queue.groups.reduce((total, item) => total + item.files.length, 0),
);
// Review opens on this page again if nothing was added.
async function add(action: () => Promise<unknown>) {
  await run(action);
  await go("review");
}
</script>

<template>
  <div class="page">
    <div class="above">
      <div class="head">
        <div>
          <h1>Add files</h1>
          <p v-if="store.queue.groups.length">
            {{ plural(fileCount, "file") }} in
            {{ plural(store.queue.groups.length, "group") }} already in the queue.
          </p>
          <p v-else>Nothing in the queue.</p>
        </div>
      </div>
    </div>
    <div class="drop">
      <h2>Drop a folder or files here</h2>
      <p class="muted">
        Video files are grouped by show or film and matched for you to confirm.
      </p>
      <div class="row">
        <button
          class="btn primary"
          type="button"
          :disabled="store.busy"
          @click="add(api.addFolder)"
        >
          Add folder
        </button>
        <button class="btn" type="button" :disabled="store.busy" @click="add(api.addFiles)">
          Add files
        </button>
      </div>
    </div>
  </div>
</template>
