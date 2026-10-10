<script setup lang="ts">
import { computed } from "vue";
import type { PreviewItem } from "../../core/types.ts";
import ListItem from "../components/ListItem.vue";
import SplitView from "../components/SplitView.vue";
import { api, apply, go, plural, run, saveSettings, store } from "../store.ts";

const preview = computed(() => store.preview);
const hasProblem = (key: string) => {
  const group = preview.value?.groups.find((item) => item.key === key);
  return !!group && (group.problems.length > 0 || group.items.some((item) => item.problem));
};
const group = computed(() => {
  const groups = preview.value?.groups ?? [];
  return (
    groups.find((item) => item.key === store.previewSelected) ??
    groups.find((item) => hasProblem(item.key)) ??
    groups[0]
  );
});
const clashes = computed(
  () =>
    preview.value?.groups.flatMap((item) => item.items).filter((item) => item.problem)
      .length ?? 0,
);

interface Row {
  depth: number;
  name: string;
  isNew: boolean;
  /** The name an imported folder had before it took its title's. */
  was?: string;
  item?: PreviewItem;
}
/** The selected group's changes as an indented folder tree, folders before their contents. */
const rows = computed<Row[]>(() => {
  const created = new Set(preview.value?.newFolders);
  const seen = new Set<string>();
  const out: Row[] = [];
  const items = [...(group.value?.items ?? [])].sort((a, b) => a.to.localeCompare(b.to));
  for (const item of items) {
    const parts = item.to.split("/");
    parts.slice(0, -1).forEach((name, depth) => {
      const folder = parts.slice(0, depth + 1).join("/");
      if (seen.has(folder)) return;
      seen.add(folder);
      out.push({
        depth,
        name: `${name}/`,
        isNew: created.has(folder),
        was: preview.value?.renamedFolders.find((item) => item.to === folder)?.from,
      });
    });
    out.push({ depth: parts.length - 1, name: parts.at(-1)!, isNew: false, item });
  }
  return out;
});
const options = [
  ["organize", "Organise into folders", "Off renames each file where it is"],
  ["subtitles", "Rename subtitles too", "Keeps language tags such as .en.forced"],
  ["sidecars", "Move existing NFO files and artwork", "Those named after a video, or describing its folder"],
  ["nfo", "Write NFO metadata files", "Read by Kodi and Jellyfin, ignored by Plex"],
  ["removeEmpty", "Remove emptied folders", "Only folders left with nothing in them"],
  ["artwork", "Download posters and backdrops", "Saved in each title's folder; needs organising into folders"],
] as const;
</script>

<template>
  <div class="page">
    <template v-if="store.applied">
      <div class="above">
        <div class="head">
          <div>
            <h1>Changes applied</h1>
            <p>
              {{ store.applied.completed }} operations completed inside
              <span class="mono">{{ store.applied.destination }}</span
              >.
            </p>
          </div>
        </div>
        <div class="banner ok">
          <span>Everything moved. The original names are kept in History.</span>
          <button class="btn" type="button" @click="go('history')">
            Open History to undo
          </button>
        </div>
        <div v-if="store.applied.warnings.length" class="banner bad" role="status">
          <span
            ><b
              >{{ plural(store.applied.warnings.length, "change") }} could not be
              made.</b
            >
            Everything else was applied.
            <span
              v-for="warning in store.applied.warnings"
              :key="warning"
              class="mono"
              style="display: block"
              >{{ warning }}</span
            ></span
          >
        </div>
      </div>
      <div class="card">
        <p v-if="store.queue.groups.length">
          {{ plural(store.queue.groups.length, "group") }} with files that were
          not renamed
          {{ store.queue.groups.length === 1 ? "is" : "are" }} still in the queue.
        </p>
        <p v-else>The queue is empty.</p>
        <div>
          <button class="btn primary" type="button" @click="go('review')">
            Back to the queue
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="!preview">
      <div class="above">
        <div class="head">
          <div>
            <h1>Preview changes</h1>
            <p>Nothing to preview yet.</p>
          </div>
        </div>
      </div>
      <div class="card">
        <p>
          Confirm at least one group in Review that has a matched file to see its
          new names here.
        </p>
        <div>
          <button class="btn primary" type="button" @click="go('review')">
            Go to Review
          </button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="above">
        <div class="head">
          <div>
            <h1>Preview changes</h1>
            <p>
              Nothing has moved yet.
              {{
                preview.blocked
                  ? "Resolve the problems below to continue."
                  : "Existing files are never overwritten."
              }}
            </p>
          </div>
          <div class="row">
            <button class="btn" type="button" @click="go('review')">
              Back to Review
            </button>
            <button
              class="btn primary"
              type="button"
              :disabled="preview.blocked || store.busy || !api.desktop"
              @click="apply"
            >
              Apply {{ preview.counts.operations }} changes
            </button>
          </div>
        </div>
        <div class="card">
          <div class="stats">
            <span><b>{{ preview.counts.videos }}</b>{{ preview.counts.videos === 1 ? "video" : "videos" }} moved</span>
            <span><b>{{ preview.counts.subtitles }}</b>subtitles</span>
            <span><b>{{ preview.counts.folders }}</b>folders created</span>
            <span v-if="preview.counts.renamed"><b>{{ preview.counts.renamed }}</b>{{ preview.counts.renamed === 1 ? "folder" : "folders" }} renamed</span>
            <span v-if="preview.counts.removed"><b>{{ preview.counts.removed }}</b>empty {{ preview.counts.removed === 1 ? "folder" : "folders" }} removed</span>
            <span v-if="preview.counts.artwork"><b>{{ preview.counts.artwork }}</b>{{ preview.counts.artwork === 1 ? "image" : "images" }}</span>
            <span v-if="preview.counts.metadata"><b>{{ preview.counts.metadata }}</b>metadata files</span>
            <span v-if="preview.counts.left"><b>{{ preview.counts.left }}</b>left where {{ preview.counts.left === 1 ? "it is" : "they are" }}</span>
          </div>
          <div class="opts">
            <label v-for="[key, label, note] in options" :key="key" class="check">
              <input
                type="checkbox"
                :checked="store.settings[key]"
                :disabled="store.busy"
                @change="saveSettings({ [key]: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ label }}<small>{{ note }}</small></span>
            </label>
          </div>
        </div>
        <div v-if="clashes" class="banner bad">
          <span
            ><b>{{ plural(clashes, "file") }} cannot be renamed as planned.</b>
            Leave the affected files out, or change the match in Review.</span
          >
        </div>
        <div v-for="error in preview.errors" :key="error" class="banner bad">
          <span>{{ error }}</span>
        </div>
      </div>

      <SplitView v-if="group" :current="group.key" list="Confirmed groups" detail="Changes for the selected group">
        <template #side>
          <ListItem
            v-for="item in preview.groups"
            :key="item.key"
            :current="item.key === group.key"
            :tone="hasProblem(item.key) ? 'bad' : 'ok'"
            :note="hasProblem(item.key) ? 'Needs attention' : plural(item.items.length, 'change')"
            :count="item.items.length"
            unit="changes"
            @click="store.previewSelected = item.key"
          >
            {{ item.title }} <span class="muted">({{ item.year ?? "year unknown" }})</span>
          </ListItem>
        </template>
        <div class="row between">
          <div>
            <span class="kind">{{ group.kind === "tv" ? "TV" : "FILM" }}</span>
            <h2 class="title">
              {{ " " + group.title }}
              <span class="muted">({{ group.year ?? "year unknown" }})</span></h2
            >
          </div>
          <span class="pill" :class="hasProblem(group.key) ? 'bad' : 'ok'">{{
            hasProblem(group.key) ? "Needs attention" : "Ready"
          }}</span>
        </div>
        <p v-for="problem in group.problems" :key="problem" class="issue bad">
          {{ problem }}
        </p>
        <div class="fill">
          <h3 class="label">Inside {{ preview.destination }}</h3>
          <div class="tree scroll" role="list">
            <span v-if="!rows.length" class="muted"
              >Nothing from this group will change.</span
            >
            <div
              v-for="(row, index) in rows"
              :key="index"
              class="node"
              role="listitem"
              :class="{ dir: !row.item, clash: row.item?.problem }"
              :style="{ paddingLeft: `${row.depth * 18}px` }"
            >
              <span>{{ row.name }}</span>
              <span v-if="row.isNew" class="tag">new folder</span>
              <span v-if="row.was" class="tag">renamed</span>
              <span v-if="row.was" class="src">from {{ row.was }}/</span>
              <template v-if="row.item">
                <button
                  v-if="row.item.problem || row.item.note"
                  class="btn"
                  type="button"
                  :disabled="store.busy"
                  :aria-label="`Leave this one out: ${row.item.from ?? row.name}`"
                  @click="run(() => api.exclude(row.item!.fileId, true))"
                >
                  Leave this one out
                </button>
                <span class="src"
                  >{{
                    row.item.from
                      ? `from ${row.item.from}`
                      : row.item.kind === "artwork"
                        ? "downloaded when the batch is applied"
                        : "new metadata file"
                  }}<template v-if="row.item.note"> · {{ row.item.note }}</template
                  ><template v-if="row.item.problem"> · {{ row.item.problem }}</template></span
                >
              </template>
            </div>
          </div>
        </div>
        <div v-if="group.left.length" class="fill">
          <h3 class="label">
            Left where {{ group.left.length === 1 ? "it is" : "they are" }}
          </h3>
          <div class="scroll">
            <div
              v-for="name in group.left"
              :key="name"
              class="mono muted"
              style="padding-top: 5px"
            >
              {{ name }}
            </div>
          </div>
        </div>
      </SplitView>

      <details v-if="preview.removedFolders.length" class="card">
        <summary>
          {{ plural(preview.removedFolders.length, "folder") }} left empty will
          be removed
        </summary>
        <div class="scroll capped">
          <div
            v-for="folder in preview.removedFolders"
            :key="folder"
            class="mono muted"
          >
            {{ folder }}/
          </div>
        </div>
        <p class="muted">
          A folder that still holds anything, such as samples, artwork or notes,
          is kept. Undo puts removed folders back.
        </p>
      </details>
    </template>
  </div>
</template>
