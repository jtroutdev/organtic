<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type {
  Catalogue,
  MediaKind,
  QueueFile,
} from "../../core/types.ts";
import ActionButton from "../components/ActionButton.vue";
import AppDialog from "../components/AppDialog.vue";
import EpisodeCode from "../components/EpisodeCode.vue";
import FilePath from "../components/FilePath.vue";
import GroupHeading from "../components/GroupHeading.vue";
import FileRow from "../components/FileRow.vue";
import IssueText from "../components/IssueText.vue";
import ListItem from "../components/ListItem.vue";
import MatchCard from "../components/MatchCard.vue";
import PosterImage from "../components/PosterImage.vue";
import ProgressBar from "../components/ProgressBar.vue";
import SegmentedSet from "../components/SegmentedSet.vue";
import SelectInput from "../components/SelectInput.vue";
import SelectionBar from "../components/SelectionBar.vue";
import SplitView from "../components/SplitView.vue";
import StatusNote from "../components/StatusNote.vue";
import StatusPill from "../components/StatusPill.vue";
import StepFooter from "../components/StepFooter.vue";
import TextInput from "../components/TextInput.vue";
import TickBox from "../components/TickBox.vue";
import ViewTab from "../components/ViewTab.vue";
import WebLink from "../components/WebLink.vue";
import { focusOn, vFocus } from "../focus.ts";
import { vTip } from "../tip.ts";
import {
  STATUS,
  announce,
  api,
  confirmAndNext,
  confirmed,
  currentGroup,
  filtered,
  go,
  nameOf,
  plural,
  run,
  selectNext,
  store,
  unconfirmed,
} from "../store.ts";
import type { Filter } from "../store.ts";

const groups = computed(filtered);
const group = computed(currentGroup);
const match = computed(() =>
  group.value?.chosen == null
    ? null
    : group.value.candidates[group.value.chosen],
);
const fileCount = computed(() =>
  store.queue.groups.reduce((total, item) => total + item.files.length, 0),
);
const suggested = computed(
  () => store.queue.groups.filter((item) => item.status === "suggested").length,
);
const readyFiles = computed(() =>
  confirmed().reduce(
    (total, item) =>
      total + item.files.filter((file) => file.target && !file.excluded).length,
    0,
  ),
);
const waiting = computed(unconfirmed);
// A file left out of the batch is no longer a problem to solve.
const isProblem = (file: QueueFile) => !!file.issue && !file.excluded;
const problemsIn = (item: { files: QueueFile[] }) => item.files.filter(isProblem).length;
const filters: [Filter, string][] = [
  ["all", "All"],
  ["todo", "Needs you"],
  ["confirmed", "Confirmed"],
];
const countFor = (filter: Filter) =>
  store.queue.groups.filter((item) =>
    filter === "all" ? true : (item.status === "confirmed") === (filter === "confirmed"),
  ).length;

// The search form starts from the selected group and is the user's to edit.
const query = ref("");
const kind = ref<MediaKind | "anime">("movie");
watch(
  () => [group.value?.key, group.value?.query, group.value?.kind, group.value?.anime],
  () => {
    if (!group.value) return;
    query.value = group.value.query;
    kind.value = group.value.anime ? "anime" : group.value.kind;
  },
  { immediate: true },
);
const SOURCES = { tmdb: "TMDB", tvmaze: "TVmaze", kitsu: "Kitsu" };
const kinds = computed<[MediaKind | "anime", string, string?][]>(() => [
  ["movie", "Film"],
  ["tv", "TV"],
  ["anime", "Anime", `Also searches Kitsu, as a ${group.value?.kind === "tv" ? "show" : "film"}`],
]);
const NUMBERINGS: [Catalogue, string, string?][] = [
  ["tmdb", "TMDB"],
  ["tvdb", "TVDB", "Places more specials; needs the show set to TVDB ordering in Plex"],
];

// Everything known about a candidate stays in a dialog until it is needed to tell two results apart.
const idOf = (candidate: { provider: string; id: unknown }) =>
  `${candidate.provider}-${candidate.id}`;
const details = ref<InstanceType<typeof AppDialog>>();
const detailed = ref<string | null>(null);
const detailedAt = computed(
  () => group.value?.candidates.findIndex((item) => idOf(item) === detailed.value) ?? -1,
);
const detail = computed(() => group.value?.candidates[detailedAt.value]);
const facts = computed<[string, string | number | null | undefined][]>(() => {
  const item = detail.value;
  if (!item) return [];
  const source = SOURCES[item.provider];
  const rows: [string, string | number | null | undefined][] = [
    ["Source", source],
    ["Type", item.kind === "tv" ? "TV show" : "Film"],
    ["Year", item.year ?? "Unknown"],
    ["Fit", item.fit],
    ["Language", item.language],
    [`${source} ID`, item.id],
    ["TMDB ID", item.provider === "tmdb" ? null : item.tmdbId],
    ["TVDB ID", item.tvdbId],
    ["TVDB season", item.tvdbSeason],
    ["IMDb ID", item.imdbId],
    ["Page", item.sourceUrl],
  ];
  return rows.filter(([, value]) => value != null && value !== "");
});
async function showDetails(id: string) {
  detailed.value = id;
  await nextTick();
  details.value?.open();
}
async function useDetailed() {
  const index = detailedAt.value;
  details.value?.close();
  if (index >= 0) await run(() => api.choose(group.value!.key, index));
  await focusOn(".detail");
}
// How the group was read and why this match was offered.
const why = computed(() => {
  const current = group.value;
  if (!current) return "";
  const read =
    match.value && current.parsedTitle.toLowerCase() !== match.value.title.toLowerCase()
      ? `Read as “${current.parsedTitle}”. `
      : "";
  return read + current.reason;
});

const busy = computed(() => store.busy || group.value?.status === "matching");
// The file set aside that is on its way into the queue, shown on its own button.
const including = ref<string | null>(null);
async function include(fileId: string) {
  including.value = fileId;
  await run(() => api.include(fileId));
  including.value = null;
}
async function remove() {
  const current = group.value!;
  selectNext(current.key);
  await run(() => api.remove(current.key));
  announce(`Removed ${nameOf(current)} from the queue.`);
  // The button that had focus went with the group.
  await focusOn(".detail");
}
async function confirmAll() {
  await run(api.confirmSuggested);
  announce("Suggested groups confirmed.");
}
// Ticked groups are merged or removed together. Only those in the current view count, so
// nothing out of sight is changed.
const tickedKeys = ref<string[]>([]);
const ticked = computed(() =>
  groups.value.filter((item) => tickedKeys.value.includes(item.key)),
);
// Where a shift-click range starts: the last group ticked or unticked.
let anchor: string | null = null;
function tick(key: string, on: boolean, range: boolean) {
  const keys = groups.value.map((item) => item.key);
  const from = range && anchor ? keys.indexOf(anchor) : -1;
  const at = keys.indexOf(key);
  const span = from < 0 ? [key] : keys.slice(Math.min(from, at), Math.max(from, at) + 1);
  const rest = tickedKeys.value.filter((item) => !span.includes(item));
  tickedKeys.value = on ? [...rest, ...span] : rest;
  anchor = key;
}
// A plain click opens a group; with Ctrl or Shift held it ticks instead.
function open(event: MouseEvent, key: string) {
  if (event.shiftKey) tick(key, true, true);
  else if (event.ctrlKey || event.metaKey) tick(key, !tickedKeys.value.includes(key), false);
  else store.selected = key;
}
// The merge keeps one ticked group: the one picked, else the one on screen, else the first matched.
const kept = ref<string | null>(null);
const mergeInto = computed({
  get: () =>
    (
      ticked.value.find((item) => item.key === kept.value) ??
      ticked.value.find((item) => item.key === group.value?.key) ??
      ticked.value.find((item) => item.chosen != null) ??
      ticked.value[0]
    )?.key ?? "",
  set: (key) => (kept.value = key),
});
function untick() {
  tickedKeys.value = [];
  kept.value = null;
}
// Ticks belong to the tab they were made in.
watch(
  () => store.filter,
  () => {
    untick();
    anchor = null;
  },
);
async function mergeTicked() {
  if (store.busy || ticked.value.length < 2) return;
  const count = ticked.value.length;
  const to = mergeInto.value;
  const ids = ticked.value
    .filter((item) => item.key !== to)
    .flatMap((item) => item.files.map((file) => file.id));
  const target = await run(() => api.moveFiles(ids, to));
  if (!target) return;
  untick();
  store.selected = target;
  announce(`Merged ${plural(count, "group")} into ${nameOf(group.value!)}.`);
  await focusOn(".detail");
}
async function removeTicked() {
  if (store.busy) return;
  const keys = ticked.value.map((item) => item.key);
  const all = store.queue.groups;
  const at = all.findIndex((item) => item.key === group.value?.key);
  if (keys.includes(all[at]?.key ?? "")) {
    const rest = [...all.slice(at + 1), ...all.slice(0, at)].filter(
      (item) => !keys.includes(item.key),
    );
    store.selected =
      (rest.find((item) => item.status !== "confirmed") ?? rest[0])?.key ?? null;
  }
  await run(async () => {
    for (const key of keys) await api.remove(key);
  });
  untick();
  announce(`Removed ${plural(keys.length, "group")} from the queue.`);
  await focusOn(".detail");
}
// Splitting and merging: ticked files, or the whole group, move to another group or a new one.
const NEW_GROUP = "";
const picked = ref<string[]>([]);
const moveTo = ref(NEW_GROUP);
const merging = ref(false);
const mergeTo = ref("");
const others = computed(() =>
  store.queue.groups.filter((item) => item.key !== group.value?.key),
);
// A lone file in the only group has nowhere to go.
const canMove = computed(
  () => (group.value?.files.length ?? 0) > 1 || others.value.length > 0,
);
// Only files still in this group count, in case the queue changed underneath the ticks.
const pickedHere = computed(() =>
  picked.value.filter((id) => group.value?.files.some((file) => file.id === id)),
);
const allPicked = computed(
  () => !!group.value && pickedHere.value.length === group.value.files.length,
);
function pickFile(id: string, on: boolean) {
  const rest = picked.value.filter((item) => item !== id);
  picked.value = on ? [...rest, id] : rest;
}
function pickAll(on: boolean) {
  picked.value = on ? group.value!.files.map((file) => file.id) : [];
}
function startMerge() {
  merging.value = true;
  mergeTo.value = others.value[0]?.key ?? "";
}
async function move(whole: boolean) {
  if (store.busy) return;
  const current = group.value!;
  const ids = whole ? current.files.map((file) => file.id) : pickedHere.value;
  const to = whole ? mergeTo.value : moveTo.value || null;
  if (!ids.length || (whole && !to)) return;
  const target = await run(() => api.moveFiles(ids, to));
  picked.value = [];
  merging.value = false;
  moveTo.value = NEW_GROUP;
  if (!target) return;
  announce(`Moved ${plural(ids.length, "file")}.`);
  // Follow the files only when the group they left no longer exists.
  if (ids.length === current.files.length) store.selected = target;
  await focusOn(".detail");
}
watch(
  () => group.value?.key,
  () => {
    picked.value = [];
    merging.value = false;
    moveTo.value = NEW_GROUP;
  },
);

// One file's season and episode can be corrected at a time; empty fields mean "none".
const editing = ref<string | null>(null);
const numbers = ref({ season: "", episode: "", episodeEnd: "" });
// The session's own rules, applied here so a wrong number is marked at the field it was typed in.
// Nothing is marked until a save has been tried.
const numbersTried = ref(false);
const numberErrors = computed(() => {
  const text = (value: string | number) => String(value).trim();
  const whole = (value: string, min: number, max: number) =>
    /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
  const [season, episode, episodeEnd] = [
    text(numbers.value.season),
    text(numbers.value.episode),
    text(numbers.value.episodeEnd),
  ];
  const first = whole(episode, 1, 9999);
  return {
    season:
      season === "" || whole(season, 0, 999)
        ? ""
        : "Enter a season from 0 to 999, or leave it empty.",
    episode: first ? "" : "Enter an episode number from 1 to 9999.",
    episodeEnd:
      episodeEnd === "" || !first || whole(episodeEnd, Number(episode) + 1, Number(episode) + 20)
        ? ""
        : "The last episode must come after the first, at most 20 later.",
  };
});
const numbersError = computed(
  () =>
    (numbersTried.value &&
      (numberErrors.value.season || numberErrors.value.episode || numberErrors.value.episodeEnd)) ||
    "",
);
function show(file: QueueFile | undefined) {
  editing.value = file?.id ?? null;
  numbersTried.value = false;
  if (!file) return;
  numbers.value = {
    season: String(file.numbers.season ?? ""),
    episode: String(file.numbers.episode ?? ""),
    episodeEnd: String(file.numbers.episodeEnd ?? ""),
  };
}
/** Opens a file's form, brings its row into view and puts the keyboard in it. */
async function edit(file: QueueFile) {
  show(file);
  await nextTick();
  const row = document.querySelector<HTMLElement>(`[data-file="${CSS.escape(file.id)}"]`);
  row?.scrollIntoView({ block: "nearest" });
  row?.querySelector<HTMLElement>(".edit input, .edit button")?.focus();
}
// Problems are walked like search results: one at a time, back and forth, each opening its form
// where it sits in the list.
const problemFiles = computed(() => group.value?.files.filter(isProblem) ?? []);
const problemAt = computed(() =>
  problemFiles.value.findIndex((file) => file.id === editing.value),
);
function step(by: 1 | -1) {
  const list = problemFiles.value;
  if (!list.length) return;
  const to =
    problemAt.value < 0
      ? by > 0
        ? 0
        : list.length - 1
      : (problemAt.value + by + list.length) % list.length;
  const file = list[to]!;
  void edit(file);
  announce(`Problem ${to + 1} of ${list.length}: ${file.issue}`);
}
/** Once a problem is dealt with: on to the next one down the list, wrapping round. */
async function onward(fileId: string) {
  await nextTick();
  const files = group.value?.files ?? [];
  const from = files.findIndex((file) => file.id === fileId);
  const next = [...files.slice(from + 1), ...files.slice(0, Math.max(from, 0))].find(isProblem);
  if (next) return edit(next);
  // Still unsolved and the only one: stay on it.
  if (files.some((file) => file.id === fileId && isProblem(file))) return;
  closeEdit(fileId);
  announce("No problems left in this group.");
}
async function leaveOut(fileId: string) {
  if (store.busy) return;
  await run(() => api.exclude(fileId, true));
  await onward(fileId);
}
// A group opens on its first problem, without taking the keyboard from the queue.
watch(
  () => group.value?.key,
  () => show(problemFiles.value[0]),
  { immediate: true },
);
// Closing the form removes the control that had focus; hand it back to the file's episode button.
function closeEdit(fileId: string) {
  editing.value = null;
  void focusOn(`[data-file="${fileId}"] .ep`);
}
async function saveNumbers(fileId: string, thenNext = false) {
  const value = (text: string | number) =>
    String(text).trim() === "" ? null : Number(text);
  const { season, episode, episodeEnd } = numbers.value;
  store.error = "";
  numbersTried.value = true;
  if (numbersError.value) {
    await focusOn('.edit [aria-invalid="true"]');
    return;
  }
  try {
    await api.setEpisode(fileId, {
      season: value(season),
      episode: value(episode),
      episodeEnd: value(episodeEnd),
    });
    announce("Season and episode updated.");
    if (thenNext) await onward(fileId);
    else closeEdit(fileId);
  } catch (error) {
    // Keep the form open so the numbers can be fixed.
    store.error = (error instanceof Error ? error.message : String(error)).replace(
      /^Error invoking remote method '[^']+': (?:Error: )?/,
      "",
    );
  }
}
const setNumbering = (numbering: Catalogue) =>
  run(async () => {
    await api.setNumbering(group.value!.key, numbering);
    announce(`Numbered as ${numbering === "tvdb" ? "TVDB" : "TMDB"} lists them.`);
  });
const setOrdering = (id: string | null, keepNumbers: boolean) =>
  run(async () => {
    await api.setOrdering(group.value!.key, id, keepNumbers);
    announce("Episode order updated.");
  });
// An empty search is marked at the field, once it has been tried.
const searchTried = ref(false);
const searchEmpty = computed(() => searchTried.value && !query.value.trim());
async function search() {
  searchTried.value = true;
  if (searchEmpty.value) return focusOn("#search-title");
  searchTried.value = false;
  await run(() =>
    api.search(group.value!.key, {
      query: query.value,
      kind: kind.value,
    }),
  );
}
</script>

<template>
  <div class="page bare">
      <h1 class="sr-only">Matching</h1>
      <SplitView flush-head :current="group?.key" list="Groups" detail="Selected group" :aria-busy="group?.status === 'matching'">
        <template #head>
          <div class="queue">
            <div class="row between">
              <h2>Queue</h2>
              <div class="row" role="group" aria-label="Add to the queue">
                <ActionButton icon="plus" aria-label="Add files" :disabled="store.busy" @click="run(api.addFiles)">
                  Files
                </ActionButton>
                <ActionButton icon="plus" aria-label="Add folder" :disabled="store.busy" @click="run(api.addFolder)">
                  Folder
                </ActionButton>
              </div>
            </div>
            <div class="views">
              <label v-if="groups.length > 1" class="pick">
                <TickBox
                  aria-label="Select all groups"
                  :checked="ticked.length === groups.length"
                  :indeterminate="ticked.length > 0 && ticked.length < groups.length"
                  @change="
                    tickedKeys = ($event.target as HTMLInputElement).checked
                      ? groups.map((item) => item.key)
                      : []
                  "
                />
              </label>
              <ViewTab
                v-for="[id, label] in filters"
                :key="id"
                :pressed="store.filter === id"
                :count="countFor(id)"
                @click="store.filter = id"
              >
                {{ label }}
              </ViewTab>
            </div>
            <!-- Lookups fill the rule under the queue's heading, so nothing moves to make room. -->
            <ProgressBar
              v-if="store.queue.lookups"
              under
              label="Lookups done"
              :value="store.queue.lookups.done"
              :max="store.queue.lookups.total"
            />
          </div>
        </template>
        <template v-if="store.queue.skipped.length" #foot>
          <details>
            <summary>
              {{ plural(store.queue.skipped.length, "file") }} set aside as samples
              or extras
            </summary>
            <div class="scroll capped skipped">
              <div v-for="file in store.queue.skipped" :key="file.id">
                <span class="mono">{{ file.source }}</span>
                <span class="row between">
                  <StatusPill tone="off">{{ file.reason }}</StatusPill>
                  <ActionButton :disabled="store.busy" @click="include(file.id)">
                    {{ including === file.id ? "Including…" : "Include" }}
                  </ActionButton>
                </span>
              </div>
            </div>
          </details>
        </template>
        <template #side>
          <div v-for="item in groups" :key="item.key" class="tickrow">
            <label class="pick">
              <TickBox
                :aria-label="`Select ${nameOf(item)}`"
                :checked="tickedKeys.includes(item.key)"
                :tabindex="item.key === group?.key ? 0 : -1"
                @click="
                  tick(item.key, ($event.target as HTMLInputElement).checked, $event.shiftKey)
                "
              />
            </label>
            <ListItem
              plain
              :current="item.key === group?.key"
              :tone="STATUS[item.status][0]"
              :note="STATUS[item.status][1]"
              :count="item.files.length"
              unit="files"
              :alert="problemsIn(item) ? plural(problemsIn(item), 'problem') : ''"
              @click="open($event, item.key)"
            >
              <template v-if="item.chosen != null">
                {{ item.candidates[item.chosen]?.title }}
                <span class="muted">({{ item.candidates[item.chosen]?.year ?? "year unknown" }})</span>
              </template>
              <template v-else>{{ item.parsedTitle || "Unnamed" }}</template>
            </ListItem>
          </div>
        </template>

        <template v-if="group">
          <!-- The group and what can be done with it, then finding its match. -->
          <div class="band">
            <SelectionBar
              v-if="ticked.length"
              aria-label="Merge or remove the selected groups"
              :summary="`${plural(ticked.length, 'group')} selected`"
              @submit="mergeTicked"
              @clear="untick"
            >
              <template v-if="ticked.length > 1">
                <label
                  >Merge into
                  <SelectInput v-model="mergeInto" class="wide">
                    <option v-for="item in ticked" :key="item.key" :value="item.key">
                      {{ nameOf(item) }}
                    </option>
                  </SelectInput></label
                >
                <ActionButton variant="primary" type="submit" :disabled="store.busy">
                  Merge
                </ActionButton>
              </template>
              <ActionButton :disabled="store.busy" @click="removeTicked">
                Remove from queue
              </ActionButton>
            </SelectionBar>
            <div class="grouprow">
              <GroupHeading
                :kind="group.kind"
                :tone="STATUS[group.status][0]"
                :status="STATUS[group.status][1]"
              >
                {{ match?.title ?? (group.parsedTitle || "Unnamed") }}
                <span v-if="match" class="muted">({{ match.year ?? "year unknown" }})</span>
              </GroupHeading>
              <form
                v-if="merging"
                class="row numbers actions"
                @submit.prevent="move(true)"
                @keydown.esc="merging = false"
              >
                <label
                  >Merge all {{ plural(group.files.length, "file") }} into
                  <SelectInput v-focus v-model="mergeTo" class="wide">
                    <option v-for="item in others" :key="item.key" :value="item.key">
                      {{ nameOf(item) }}
                    </option>
                  </SelectInput></label
                >
                <ActionButton variant="primary" type="submit" :disabled="busy">Merge</ActionButton>
                <ActionButton variant="quiet" @click="merging = false">Cancel</ActionButton>
              </form>
              <div v-else class="row actions">
                <ActionButton
                  v-if="others.length"
                  variant="quiet"
                  aria-label="Merge group into another"
                  :disabled="store.busy"
                  @click="startMerge"
                >
                  Merge group
                </ActionButton>
                <ActionButton
                  variant="quiet"
                  aria-label="Remove from queue"
                  :disabled="store.busy"
                  @click="remove"
                >
                  Remove
                </ActionButton>
                <ActionButton
                  v-if="group.status !== 'confirmed' && match"
                  variant="primary"
                  :disabled="busy"
                  @click="confirmAndNext"
                >
                  Confirm and next
                </ActionButton>
                <ActionButton v-else @click="selectNext(group.key)">Next group</ActionButton>
              </div>
            </div>
            <StatusNote v-if="why" :tone="STATUS[group.status][0]">{{ why }}</StatusNote>
            <div class="matching">
              <div class="row between">
                <form class="row" novalidate @submit.prevent="search">
                  <TextInput
                    id="search-title"
                    v-model="query"
                    class="search"
                    aria-label="Search title"
                    aria-required="true"
                    :invalid="searchEmpty"
                    aria-describedby="search-error"
                    maxlength="200"
                  />
                  <SegmentedSet v-model="kind" label="Type" :options="kinds" />
                  <ActionButton type="submit" :disabled="busy">Search</ActionButton>
                  <IssueText v-if="searchEmpty" id="search-error" bad role="alert"
                    >Enter a title to search for.</IssueText
                  >
                </form>
              <div
                v-if="group.kind === 'tv' && group.orderings.length"
                class="row numbers sort"
              >
                <label
                  >Sort matches
                  <SelectInput
                    class="wide"
                    :model-value="group.ordering ?? ''"
                    :disabled="busy"
                    @update:model-value="setOrdering($event || null, group.keepNumbers)"
                  >
                    <option value="">Aired order</option>
                    <option
                      v-for="item in group.orderings"
                      :key="item.id"
                      :value="item.id"
                    >
                      {{ item.name }}
                    </option>
                  </SelectInput></label
                >
                <label v-if="group.ordering" class="pick">
                  <TickBox
                    :checked="group.keepNumbers"
                    :disabled="busy"
                    @change="
                      setOrdering(
                        group.ordering,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                  Keep these numbers in the new names
                </label>
              </div>
              </div>
              <div v-if="group.numberingChoice" class="row numbers">
                <span class="hint"
                  >Number seasons and episodes as</span
                >
                <SegmentedSet
                  label="Number seasons and episodes as"
                  :options="NUMBERINGS"
                  :model-value="group.numbering"
                  :disabled="busy"
                  @update:model-value="setNumbering"
                />
              </div>
              <div class="strip" role="group" aria-label="Matches">
                <MatchCard
                  v-for="(candidate, index) in group.candidates"
                  :key="idOf(candidate)"
                  :candidate="candidate"
                  :source="SOURCES[candidate.provider]"
                  :chosen="group.chosen === index"
                  :confirmed="group.status === 'confirmed'"
                  :disabled="busy"
                  @use="run(() => api.choose(group!.key, index))"
                  @details="showDetails(idOf(candidate))"
                />
              </div>
            </div>
          </div>
          <div class="fill bleed">
            <div>
              <SelectionBar
                v-if="pickedHere.length"
                aria-label="Move the selected files"
                :summary="`${pickedHere.length} selected`"
                @submit="move(false)"
                @clear="picked = []"
              >
                <label
                  >Move to
                  <SelectInput v-model="moveTo" class="wide">
                    <option :value="NEW_GROUP">A new group</option>
                    <option v-for="item in others" :key="item.key" :value="item.key">
                      {{ nameOf(item) }}
                    </option>
                  </SelectInput></label
                >
                <ActionButton variant="primary" type="submit" :disabled="busy">Move</ActionButton>
              </SelectionBar>
            </div>
            <div class="files scroll">
              <FileRow heading>
                <label class="pick label">
                  <TickBox
                    v-if="canMove && group.files.length > 1"
                    aria-label="Select all files"
                    :checked="allPicked"
                    :indeterminate="pickedHere.length > 0 && !allPicked"
                    @change="pickAll(($event.target as HTMLInputElement).checked)"
                  />
                  {{ plural(group.files.length, "file") }}
                </label>
                <span class="label">Current name</span>
                <span class="row between">
                  <span class="label">New name</span>
                  <span
                    v-if="problemFiles.length"
                    class="row problems"
                    role="group"
                    aria-label="Problems in this group"
                  >
                    <StatusPill tone="warn">{{
                      problemAt < 0
                        ? plural(problemFiles.length, "problem")
                        : `Problem ${problemAt + 1} of ${problemFiles.length}`
                    }}</StatusPill>
                    <ActionButton data-step="-1" aria-label="Previous problem" @click="step(-1)">
                      Previous
                    </ActionButton>
                    <ActionButton data-step="1" aria-label="Next problem" @click="step(1)">
                      Next
                    </ActionButton>
                  </span>
                </span>
              </FileRow>
              <FileRow
                v-for="file in group.files"
                :key="file.id"
                :problem="isProblem(file)"
                :current="editing === file.id && isProblem(file)"
                :data-file="file.id"
              >
                <span class="pick">
                  <TickBox
                    v-if="canMove"
                    :checked="picked.includes(file.id)"
                    :value="file.id"
                    :aria-label="`Select ${file.source}`"
                    @change="pickFile(file.id, ($event.target as HTMLInputElement).checked)"
                  />
                  <EpisodeCode
                    v-if="group.kind === 'tv'"
                    v-tip="'Change season or episode'"
                    editable
                    :problem="isProblem(file)"
                    :aria-label="`${file.label}: change season or episode for ${file.source}`"
                    :aria-expanded="editing === file.id"
                    @click="edit(file)"
                  >
                    {{ file.label }}
                  </EpisodeCode>
                  <EpisodeCode v-else :problem="isProblem(file)">{{ file.label }}</EpisodeCode>
                </span>
                <FilePath :path="file.source" :tip="file.path" muted />
                <span v-if="file.excluded"
                  ><span class="muted">Left out of the next batch. </span>
                  <ActionButton @click="run(() => api.exclude(file.id, false))">
                    Include again
                  </ActionButton></span
                >
                <IssueText v-else-if="file.issue" :strong="editing === file.id">{{ file.issue }}</IssueText>
                <FilePath v-else-if="file.target" :path="file.target" />
                <span v-else class="muted">Appears once a match is chosen.</span>
                <form
                  v-if="editing === file.id && (group.kind === 'tv' || isProblem(file))"
                  class="row numbers edit"
                  novalidate
                  :aria-label="
                    group.kind === 'tv'
                      ? `Season and episode for ${file.source}`
                      : `Problem with ${file.source}`
                  "
                  @submit.prevent="group.kind === 'tv' && saveNumbers(file.id, isProblem(file))"
                  @keydown.esc="closeEdit(file.id)"
                >
                  <template v-if="group.kind === 'tv'">
                  <label
                    >Season
                    <TextInput v-model="numbers.season" type="number" min="0" max="999" placeholder="none"
                      :invalid="numbersTried && !!numberErrors.season" aria-describedby="numbers-error"
                  /></label>
                  <label
                    >Episode
                    <TextInput v-model="numbers.episode" type="number" min="1" max="9999" aria-required="true"
                      :invalid="numbersTried && !!numberErrors.episode" aria-describedby="numbers-error"
                  /></label>
                  <label
                    ><span aria-hidden="true">to</span
                    ><span class="sr-only">Last episode, for a multi-episode file</span>
                    <TextInput v-model="numbers.episodeEnd" type="number" min="2" max="9999" placeholder="single"
                      :invalid="numbersTried && !!numberErrors.episodeEnd" aria-describedby="numbers-error"
                  /></label>
                  <IssueText v-if="numbersError" id="numbers-error" bad role="alert">{{
                    numbersError
                  }}</IssueText>
                  </template>
                  <template v-if="isProblem(file)">
                    <!-- Both move on to the next problem. -->
                    <ActionButton v-if="group.kind === 'tv'" variant="primary" type="submit" :disabled="busy">
                      Save
                    </ActionButton>
                    <ActionButton
                      v-tip="'Leave this file out of the batch'"
                      :disabled="busy"
                      @click="leaveOut(file.id)"
                    >
                      Skip
                    </ActionButton>
                  </template>
                  <template v-else>
                    <ActionButton variant="primary" type="submit" :disabled="busy">Save</ActionButton>
                    <ActionButton variant="quiet" @click="closeEdit(file.id)">Cancel</ActionButton>
                  </template>
                </form>
              </FileRow>
            </div>
          </div>

        </template>
        <p v-else class="muted">No groups in this view.</p>
      </SplitView>

      <StepFooter>
        <template #back>
          <ActionButton :disabled="store.busy" @click="run(api.clear)">Clear queue</ActionButton>
          <template v-if="store.queue.lookups">
            <span class="muted"
              >Looking up matches: {{ store.queue.lookups.done }} of
              {{ plural(store.queue.lookups.total, "group") }} done</span
            >
            <ActionButton @click="run(api.cancelLookups).then(() => announce('Lookups cancelled.'))">
              Cancel lookups
            </ActionButton>
          </template>
          <span v-else class="muted">
            {{ plural(fileCount, "file") }} in {{ plural(store.queue.groups.length, "group") }}
          </span>
        </template>
        <span v-if="waiting" class="muted">{{ plural(waiting, "group") }} left to confirm</span>
        <ActionButton v-if="suggested" :disabled="store.busy" @click="confirmAll">
          Confirm {{ suggested }} suggested
        </ActionButton>
        <ActionButton variant="primary" :unavailable="!readyFiles || !!waiting" @click="go('preview')">
          Preview changes
        </ActionButton>
      </StepFooter>
    <AppDialog ref="details" wide labelledby="details-title" @close="detailed = null">
      <template v-if="detail">
        <div class="about">
          <PosterImage large :src="detail.posterUrl" :thumb="detail.posterThumbUrl" />
          <div>
            <h2 id="details-title" class="title">
              {{ detail.title }}
              <span class="muted">({{ detail.year ?? "year unknown" }})</span>
            </h2>
            <p>{{ detail.overview || "No description available." }}</p>
          </div>
        </div>
        <dl>
          <template v-for="[name, value] in facts" :key="name">
            <dt class="label">{{ name }}</dt>
            <dd v-if="name === 'Page'">
              <WebLink @click="api.openSourcePage(String(value))">
                {{ String(value).replace(/^https:\/\/(www\.)?/, "") }}
              </WebLink>
            </dd>
            <dd v-else :class="{ mono: name.endsWith('ID') }">{{ value }}</dd>
          </template>
        </dl>
        <form class="row" method="dialog">
          <ActionButton
            v-if="group?.chosen !== detailedAt"
            variant="primary"
            :disabled="busy"
            @click="useDetailed"
          >
            Use this
          </ActionButton>
          <ActionButton type="submit">Close</ActionButton>
        </form>
      </template>
    </AppDialog>
  </div>
</template>

<style scoped>
/* The top of the queue: its heading with the ways to add to it, then the list's views as tabs
   resting on the rule above the list. */
.queue{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-nested)}
.views{display:flex;gap:var(--space-nested);align-items:center}
.skipped>div{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-dense);padding:var(--space-nested) 0}
.skipped>div+div{border-top:1px solid var(--color-outline-subtle)}
/* A list item with a tick box beside it; the row takes over the item's rule, background and
   selected edge. */
.tickrow{display:grid;grid-template-columns:auto minmax(0,1fr);border-bottom:1px solid var(--color-outline-subtle)}
.tickrow:hover{background-image:linear-gradient(var(--color-hover) 0 0)}
.tickrow:has([aria-current="true"]){background-color:var(--color-accent-soft);outline:1px solid var(--color-accent);outline-offset:-1px}
.tickrow .pick{padding-left:var(--space-surface)}
/* The top of the selected group's pane, on the list's own colour and flush with the pane's edges. */
.band{row-gap:var(--space-nested);padding-block:var(--space-surface);background:var(--color-surface-raised);border-bottom:1px solid var(--color-outline-subtle)}
/* The group's actions keep to the right when the row wraps. */
.band .actions{justify-self:end;justify-content:flex-end}
.band .sort{flex:1 1 auto;justify-content:flex-end}
/* The group on the left, wrapping within its own column so its actions stay at the top right. */
.grouprow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-nested) var(--space-surface);align-items:start}
/* Finding the match, under a rule that runs the width of the pane. */
.matching{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-nested);padding:var(--space-nested) var(--space-surface) 0;border-top:1px solid var(--color-outline-subtle)}
.input.search{flex:0 1 220px;width:220px}
.hint{font:var(--font-body-sm);font-weight:500;color:var(--color-on-surface-muted)}
.strip{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(240px,320px);justify-content:start;gap:var(--space-nested);overflow-x:auto;padding-bottom:var(--space-dense)}
/* A row scrolled to stops clear of the column headings. */
.files{display:grid;grid-template-columns:max-content minmax(0,2fr) minmax(0,3fr);grid-auto-rows:max-content;align-content:start;column-gap:var(--space-surface);scroll-padding-top:calc(var(--size-control) + var(--space-nested))}
.edit{grid-column:2/-1}
.about{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--space-surface);align-items:start}
.about>div{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-nested)}
.about p{color:var(--color-on-surface-muted)}
@media (max-width:760px){
  .files{grid-template-columns:minmax(0,1fr)}
  .grouprow{grid-template-columns:minmax(0,1fr)}
}
</style>
