<script setup lang="ts">
import { computed } from "vue";
import type { PreviewItem } from "../../core/types.ts";
import ActionButton from "../components/ActionButton.vue";
import GroupHeading from "../components/GroupHeading.vue";
import IssueText from "../components/IssueText.vue";
import ListItem from "../components/ListItem.vue";
import NoticeBanner from "../components/NoticeBanner.vue";
import OptionsMenu from "../components/OptionsMenu.vue";
import PageHeading from "../components/PageHeading.vue";
import SkeletonBlock from "../components/SkeletonBlock.vue";
import SplitView from "../components/SplitView.vue";
import StepFooter from "../components/StepFooter.vue";
import SummaryStats from "../components/SummaryStats.vue";
import SurfaceCard from "../components/SurfaceCard.vue";
import TreeRow from "../components/TreeRow.vue";
import { api, apply, confirmed, go, plural, run, saveSettings, store } from "../store.ts";

const preview = computed(() => store.preview);
// Until the first preview is back the page keeps its shape, with outlines where the names will be.
const loading = computed(() => !store.applied && !preview.value && store.previewLoading);
/** One outlined row for each group the preview is expected to list, up to a screenful. */
const expected = computed(() => Math.min(confirmed().length, 8));
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
/** The selected group as queued, which is where its destination is chosen. */
const queued = computed(() =>
  store.queue.groups.find((item) => item.key === group.value?.key),
);
// The destination is named once: beside its Change button when it can be changed.
const shownAbove = computed(
  () => store.settings.organize && group.value?.destination === queued.value?.destination,
);
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
  ["subtitles", "Rename subtitles", "Keeps language tags such as .en.forced"],
  ["sidecars", "Move NFO and artwork", "Those named after a video, or describing its folder"],
  ["nfo", "Write NFO files", "Read by Kodi and Jellyfin, ignored by Plex"],
  ["removeEmpty", "Remove empty folders", "Only folders left with nothing in them"],
  ["artwork", "Download artwork", "Posters and backdrops, saved in each title's folder; needs organising into folders"],
] as const;
const menu = computed(() =>
  options.map(([key, label, note]) => ({ key, label, note, checked: store.settings[key] })),
);
/** What the batch will do, as counts; a kind of change with none is left out. */
const stats = computed(() => {
  const counts = preview.value!.counts;
  const one = (count: number, single: string, many: string) => (count === 1 ? single : many);
  const all: [number, string, boolean?][] = [
    [counts.videos, `${one(counts.videos, "video", "videos")} moved`, true],
    [counts.subtitles, "subtitles", true],
    [counts.folders, "folders created", true],
    [counts.renamed, `${one(counts.renamed, "folder", "folders")} renamed`],
    [counts.removed, `empty ${one(counts.removed, "folder", "folders")} removed`],
    [counts.artwork, one(counts.artwork, "image", "images")],
    [counts.metadata, "metadata files"],
    [counts.left, `left where ${one(counts.left, "it is", "they are")}`],
  ];
  return all
    .filter(([count, , always]) => always || count)
    .map(([count, label]) => [count, label] as const);
});
async function toggle(key: string, box: HTMLInputElement) {
  const name = key as (typeof options)[number][0];
  // A change made while another is being saved is put back, so the tick never disagrees with the setting.
  if (store.busy || !(await saveSettings({ [name]: box.checked })))
    box.checked = store.settings[name];
}
</script>

<template>
  <div class="page" :aria-busy="loading">
    <template v-if="store.applied">
      <div class="above">
        <PageHeading title="Changes applied">
          {{ store.applied.completed }} operations completed inside
          <template v-if="store.applied.destinations.length === 1"
            ><span class="mono">{{ store.applied.destinations[0] }}</span
            >.</template
          >
          <template v-else>{{ store.applied.destinations.length }} folders.</template>
        </PageHeading>
        <NoticeBanner tone="ok"
          >Everything moved. The original names are kept in History.</NoticeBanner
        >
        <NoticeBanner v-if="store.applied.warnings.length" tone="bad" role="status"
          ><b
            >{{ plural(store.applied.warnings.length, "change") }} could not be
            made.</b
          >
          Everything else was applied.
          <span
            v-for="warning in store.applied.warnings"
            :key="warning"
            class="mono block"
            >{{ warning }}</span
          ></NoticeBanner
        >
      </div>
      <SurfaceCard>
        <p v-if="store.queue.groups.length">
          {{ plural(store.queue.groups.length, "group") }} with files that were
          not renamed
          {{ store.queue.groups.length === 1 ? "is" : "are" }} still in the queue.
        </p>
        <p v-else>The queue is empty.</p>
      </SurfaceCard>
      <StepFooter>
        <template #back>
          <ActionButton @click="go('history')">Open History to undo</ActionButton>
        </template>
        <ActionButton variant="primary" @click="go('review')">Back to the queue</ActionButton>
      </StepFooter>
    </template>

    <template v-else-if="!preview && !loading">
      <div class="above">
        <PageHeading title="Preview changes">Nothing to preview yet.</PageHeading>
      </div>
      <SurfaceCard>
        <p>
          Confirm at least one group in Matching that has a matched file to see its
          new names here.
        </p>
        <div>
          <ActionButton variant="primary" @click="go('review')">Go to Matching</ActionButton>
        </div>
      </SurfaceCard>
    </template>

    <template v-else>
      <div class="above">
        <PageHeading title="Preview changes">
          <template v-if="!preview">Working out the new names.</template>
          <template v-else>
            Nothing has moved yet.
            {{
              preview.blocked
                ? "Resolve the problems below to continue."
                : "Existing files are never overwritten."
            }}
          </template>
        </PageHeading>
        <SurfaceCard bar>
          <SummaryStats v-if="preview" :stats="stats" />
          <div v-else class="row ghoststats">
            <SkeletonBlock v-for="n in 3" :key="n" width="short" />
          </div>
          <OptionsMenu id="preview-options" label="Options" :options="menu" @toggle="toggle" />
        </SurfaceCard>
        <NoticeBanner v-if="clashes" tone="bad"
          ><b>{{ plural(clashes, "file") }} cannot be renamed as planned.</b>
          Leave the affected files out, or change the match in Matching.</NoticeBanner
        >
        <NoticeBanner v-for="error in preview?.errors" :key="error" tone="bad">{{
          error
        }}</NoticeBanner>
      </div>

      <SplitView v-if="group || loading" :current="group?.key" list="Confirmed groups" detail="Changes for the selected group">
        <template #side>
          <div v-for="n in loading ? expected : 0" :key="n" class="ghost">
            <SkeletonBlock />
            <SkeletonBlock width="short" />
          </div>
          <ListItem
            v-for="item in preview?.groups"
            :key="item.key"
            :current="item.key === group?.key"
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
          <div v-if="!group" class="ghosthead"><SkeletonBlock /></div>
          <GroupHeading
            v-else
            :kind="group.kind"
            :tone="hasProblem(group.key) ? 'bad' : 'ok'"
            :status="hasProblem(group.key) ? 'Needs attention' : 'Ready'"
          >
            {{ group.title }}
            <span class="muted">({{ group.year ?? "year unknown" }})</span>
          </GroupHeading>
          <div v-if="store.settings.organize && queued" class="dest">
            <span class="label">Organise inside</span>
            <span class="mono">{{ queued.destination }}</span>
            <ActionButton
              v-if="queued.destinationChanged"
              :disabled="store.busy"
              @click="run(() => api.resetDestination(queued!.key))"
            >
              Use the added folder
            </ActionButton>
            <ActionButton
              :disabled="store.busy"
              @click="run(() => api.chooseDestination(queued!.key))"
            >
              Change
            </ActionButton>
          </div>
        </div>
        <IssueText v-for="problem in group?.problems" :key="problem" as="p" bad>
          {{ problem }}
        </IssueText>
        <div v-if="!group" class="fill" aria-hidden="true">
          <div class="label"><SkeletonBlock width="short" /></div>
          <div class="tree">
            <TreeRow :depth="0" folder><SkeletonBlock /></TreeRow>
            <TreeRow :depth="1" folder><SkeletonBlock width="short" /></TreeRow>
            <TreeRow v-for="n in 4" :key="n" :depth="2">
              <SkeletonBlock />
              <span class="src"><SkeletonBlock width="long" /></span>
            </TreeRow>
          </div>
        </div>
        <div v-else class="fill">
          <h3 class="label">
            {{ shownAbove ? "New location" : `Inside ${group.destination}` }}
          </h3>
          <div class="tree scroll" role="list">
            <span v-if="!rows.length" class="muted"
              >Nothing from this group will change.</span
            >
            <TreeRow
              v-for="(row, index) in rows"
              :key="index"
              :depth="row.depth"
              :folder="!row.item"
              :clash="!!row.item?.problem"
            >
              <span>{{ row.name }}</span>
              <span v-if="row.isNew" class="tag">new folder</span>
              <span v-if="row.was" class="tag">renamed</span>
              <span v-if="row.was" class="src">from {{ row.was }}/</span>
              <template v-if="row.item">
                <ActionButton
                  v-if="row.item.problem || row.item.note"
                  :disabled="store.busy"
                  :aria-label="`Leave this one out: ${row.item.from ?? row.name}`"
                  @click="run(() => api.exclude(row.item!.fileId, true))"
                >
                  Leave this one out
                </ActionButton>
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
            </TreeRow>
          </div>
        </div>
        <div v-if="group?.left.length" class="fill">
          <h3 class="label">
            Left where {{ group?.left.length === 1 ? "it is" : "they are" }}
          </h3>
          <div class="scroll">
            <div
              v-for="name in group?.left"
              :key="name"
              class="mono muted leftover"
            >
              {{ name }}
            </div>
          </div>
        </div>
      </SplitView>

      <SurfaceCard v-if="preview?.removedFolders.length" as="details">
        <summary>
          {{ plural(preview?.removedFolders.length ?? 0, "folder") }} left empty will
          be removed
        </summary>
        <div class="scroll capped">
          <div
            v-for="folder in preview?.removedFolders"
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
      </SurfaceCard>
      <StepFooter>
        <template #back>
          <ActionButton @click="go('review')">Back to Matching</ActionButton>
        </template>
        <ActionButton
          variant="primary"
          :unavailable="preview?.blocked || !api.desktop"
          :disabled="store.busy || !preview"
          @click="apply"
        >
          Apply {{ preview?.counts.operations }} changes
        </ActionButton>
      </StepFooter>
    </template>
  </div>
</template>

<style scoped>
.dest{display:flex;flex-wrap:wrap;gap:var(--space-dense) var(--space-nested);align-items:center}
.dest .mono{min-width:0}
.tree{font:var(--font-code-md);font-weight:400;display:grid;grid-template-columns:minmax(0,1fr);grid-auto-rows:max-content;align-content:start;overflow-wrap:anywhere}
.tag{font:var(--font-label-sm);letter-spacing:var(--tracking-label);text-transform:uppercase;color:var(--color-success)}
.src{flex-basis:100%;color:var(--color-on-surface-muted)}
.leftover{padding-top:var(--space-dense)}
/* Outlines of what is on its way, each with the measure of the thing it stands in for: the
   counts, a row of the list and the group's heading. */
.ghoststats{gap:var(--space-dense) var(--space-surface)}
.ghost{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-dense);padding:var(--space-nested) var(--space-surface);border-bottom:1px solid var(--color-outline-subtle)}
.ghost>:last-child{font:var(--font-body-sm)}
.ghosthead{display:grid;align-items:center;min-height:var(--size-control);font:var(--font-title-lg)}
</style>
