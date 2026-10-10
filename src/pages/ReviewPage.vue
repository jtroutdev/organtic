<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type {
  Catalogue,
  MediaKind,
  QueueFile,
} from "../../core/types.ts";
import ListItem from "../components/ListItem.vue";
import SplitView from "../components/SplitView.vue";
import { focusOn, vFocus } from "../focus.ts";
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
const problems = computed(
  () => group.value?.files.filter((file) => file.issue).length ?? 0,
);
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

// Everything known about a candidate stays in a dialog until it is needed to tell two results apart.
const idOf = (candidate: { provider: string; id: unknown }) =>
  `${candidate.provider}-${candidate.id}`;
const details = ref<HTMLDialogElement>();
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
  details.value?.showModal();
}
async function useDetailed() {
  const index = detailedAt.value;
  details.value?.close();
  if (index >= 0) await run(() => api.choose(group.value!.key, index));
  await focusOn(".detail");
}
// Posters are shown small; TMDB and TVmaze serve a reduced size at a predictable address.
const thumb = (url: string) =>
  url
    .replace("/t/p/original/", "/t/p/w154/")
    .replace("/original_untouched/", "/medium_portrait/");
const broken = ref<string[]>([]);
function posterFailed(event: Event, candidate: { provider: string; id: unknown; posterUrl?: string }) {
  const image = event.target as HTMLImageElement;
  // Fall back to the full-size poster once before giving up on it.
  if (candidate.posterUrl && image.src !== candidate.posterUrl) image.src = candidate.posterUrl;
  else broken.value = [...broken.value, idOf(candidate)];
}
// How the group was read and why this match was offered, on one line unless it needs attention.
const attention = computed(
  () => !!group.value && !["suggested", "confirmed"].includes(group.value.status),
);
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
function edit(file: QueueFile) {
  editing.value = file.id;
  numbers.value = {
    season: String(file.numbers.season ?? ""),
    episode: String(file.numbers.episode ?? ""),
    episodeEnd: String(file.numbers.episodeEnd ?? ""),
  };
}
// Closing the form removes the control that had focus; hand it back to the file's episode button.
function closeEdit(fileId: string) {
  editing.value = null;
  void focusOn(`[data-file="${fileId}"] .ep`);
}
// A path is shown as its folder, which gives way first when space is short, and its file name.
function split(path: string) {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  return [path.slice(0, at), path.slice(at)];
}
async function saveNumbers(fileId: string) {
  const value = (text: string | number) =>
    String(text).trim() === "" ? null : Number(text);
  const { season, episode, episodeEnd } = numbers.value;
  store.error = "";
  try {
    await api.setEpisode(fileId, {
      season: value(season),
      episode: value(episode),
      episodeEnd: value(episodeEnd),
    });
    closeEdit(fileId);
    announce("Season and episode updated.");
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
const search = () =>
  run(() =>
    api.search(group.value!.key, {
      query: query.value,
      kind: kind.value,
    }),
  );
</script>

<template>
  <div class="page">
      <div class="above">
        <div class="head">
          <div>
            <h1>Review matches</h1>
            <p>
              {{ plural(fileCount, "file") }} in
              {{ plural(store.queue.groups.length, "group") }}.
              <template v-if="confirmed().length"
                >{{ confirmed().length }} confirmed,
                {{ plural(readyFiles, "file") }} ready.</template
              >
              <template v-else>Confirm each group once.</template>
            </p>
          </div>
          <div class="row">
            <button class="btn" type="button" :disabled="store.busy" @click="run(api.addFiles)">
              Add files
            </button>
            <button class="btn" type="button" :disabled="store.busy" @click="run(api.addFolder)">
              Add folder
            </button>
          </div>
        </div>
        <div v-if="store.queue.lookups" class="lookups">
          <div class="row between">
            <span
              >Looking up matches: {{ store.queue.lookups.done }} of
              {{ plural(store.queue.lookups.total, "group") }} done</span
            >
            <button class="btn" type="button" @click="run(api.cancelLookups).then(() => announce('Lookups cancelled.'))">
              Cancel lookups
            </button>
          </div>
          <div
            class="progress"
            role="progressbar"
            aria-label="Lookups done"
            :aria-valuenow="store.queue.lookups.done"
            aria-valuemin="0"
            :aria-valuemax="store.queue.lookups.total"
          >
            <i
              :style="{
                width: `${(store.queue.lookups.done / store.queue.lookups.total) * 100}%`,
              }"
            ></i>
          </div>
        </div>
        <div v-if="store.settings.organize" class="dest">
          <span class="label">Organise inside</span>
          <span class="mono">{{ store.queue.destination }}</span>
          <button
            v-if="store.queue.destinationChanged"
            class="btn"
            type="button"
            @click="run(api.resetDestination)"
          >
            Use the added folder
          </button>
          <button class="btn" type="button" @click="run(api.chooseDestination)">
            Change
          </button>
        </div>
      </div>

      <SplitView :current="group?.key" list="Groups" detail="Selected group" :aria-busy="group?.status === 'matching'">
        <template #head>
          <div class="chips">
            <label v-if="groups.length > 1" class="pick">
              <input
                type="checkbox"
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
            <button
              v-for="[id, label] in filters"
              :key="id"
              class="chip"
              type="button"
              :aria-pressed="store.filter === id"
              @click="store.filter = id"
            >
              {{ label }}<span>{{ countFor(id) }}</span>
            </button>
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
                  <span class="pill off">{{ file.reason }}</span>
                  <button class="btn" type="button" :disabled="store.busy" @click="run(() => api.include(file.id))">
                    Include
                  </button>
                </span>
              </div>
            </div>
          </details>
        </template>
        <template #side>
          <div v-for="item in groups" :key="item.key" class="tickrow">
            <label class="pick">
              <input
                type="checkbox"
                :aria-label="`Select ${nameOf(item)}`"
                :checked="tickedKeys.includes(item.key)"
                :tabindex="item.key === group?.key ? 0 : -1"
                @click="
                  tick(item.key, ($event.target as HTMLInputElement).checked, $event.shiftKey)
                "
              />
            </label>
            <ListItem
              :current="item.key === group?.key"
              :tone="STATUS[item.status][0]"
              :note="STATUS[item.status][1]"
              :count="item.files.length"
              unit="files"
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

        <form
          v-if="ticked.length"
          class="row numbers movebar"
          aria-label="Merge or remove the selected groups"
          @submit.prevent="mergeTicked"
          @keydown.esc="untick"
        >
          <strong>{{ plural(ticked.length, "group") }} selected</strong>
          <template v-if="ticked.length > 1">
            <label
              >Merge into
              <select v-model="mergeInto" class="input wide">
                <option v-for="item in ticked" :key="item.key" :value="item.key">
                  {{ nameOf(item) }}
                </option>
              </select></label
            >
            <button class="btn primary" type="submit" :disabled="store.busy">Merge</button>
          </template>
          <button class="btn" type="button" :disabled="store.busy" @click="removeTicked">
            Remove from queue
          </button>
          <button class="btn quiet" type="button" @click="untick">Clear selection</button>
        </form>

        <template v-if="group">
          <div class="summary">
            <div>
              <span class="kind">{{ group.kind === "tv" ? "TV" : "FILM" }}</span>
              <h2 class="title">
                {{ " " + (match?.title ?? (group.parsedTitle || "Unnamed")) }}
                <span v-if="match" class="muted">({{ match.year ?? "year unknown" }})</span>
              </h2>
            </div>
            <p :class="{ clip: !attention }" :title="attention ? undefined : why">
              {{ why }}
            </p>
            <span class="pill" :class="STATUS[group.status][0]">{{
              STATUS[group.status][1]
            }}</span>
          </div>
          <div class="cands">
            <form class="row" @submit.prevent="search">
              <input
                id="search-title"
                v-model="query"
                class="input"
                aria-label="Search title"
                required
                maxlength="200"
                style="flex: 1 1 180px; width: auto"
              />
              <div class="seg" role="group" aria-label="Type">
                <button type="button" :aria-pressed="kind === 'movie'" @click="kind = 'movie'">
                  Film
                </button>
                <button type="button" :aria-pressed="kind === 'tv'" @click="kind = 'tv'">
                  TV
                </button>
                <button
                  type="button"
                  :aria-pressed="kind === 'anime'"
                  :title="`Also searches Kitsu, as a ${group.kind === 'tv' ? 'show' : 'film'}`"
                  @click="kind = 'anime'"
                >
                  Anime
                </button>
              </div>
              <button class="btn" type="submit" :disabled="busy">Search</button>
            </form>
            <div v-if="group.numberingChoice" class="row numbers">
              <span class="muted" style="font-size: 12.5px; font-weight: 500"
                >Number seasons and episodes as</span
              >
              <div class="seg" role="group" aria-label="Number seasons and episodes as">
                <button
                  type="button"
                  :aria-pressed="group.numbering === 'tmdb'"
                  :disabled="busy"
                  @click="setNumbering('tmdb')"
                >
                  TMDB
                </button>
                <button
                  type="button"
                  :aria-pressed="group.numbering === 'tvdb'"
                  :disabled="busy"
                  title="Places more specials; needs the show set to TVDB ordering in Plex"
                  @click="setNumbering('tvdb')"
                >
                  TVDB
                </button>
              </div>
            </div>
            <div
              v-if="group.kind === 'tv' && group.orderings.length"
              class="row numbers"
            >
              <label
                >Files are numbered in
                <select
                  class="input wide"
                  :value="group.ordering ?? ''"
                  :disabled="busy"
                  @change="
                    setOrdering(
                      ($event.target as HTMLSelectElement).value || null,
                      group.keepNumbers,
                    )
                  "
                >
                  <option value="">Aired order</option>
                  <option
                    v-for="item in group.orderings"
                    :key="item.id"
                    :value="item.id"
                  >
                    {{ item.name }}
                  </option>
                </select></label
              >
              <label v-if="group.ordering" class="pick">
                <input
                  type="checkbox"
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
          <div>
            <div class="strip" role="group" aria-label="Matches">
              <div
                v-for="(candidate, index) in group.candidates"
                :key="idOf(candidate)"
                class="cand"
                :class="{ on: group.chosen === index }"
              >
                <img
                  v-if="candidate.posterUrl && !broken.includes(idOf(candidate))"
                  class="poster"
                  :src="thumb(candidate.posterUrl)"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="posterFailed($event, candidate)"
                />
                <span v-else class="poster" aria-hidden="true">{{
                  candidate.kind === "tv" ? "TV" : "FILM"
                }}</span>
                <strong :title="candidate.title"
                  >{{ candidate.title }}
                  <span class="muted">({{ candidate.year ?? "year unknown" }})</span></strong
                >
                <span class="fit" :class="{ low: candidate.weak }">
                  {{ candidate.fit }} ·
                  {{ SOURCES[candidate.provider] }}
                </span>
                <span class="row">
                  <span v-if="group.chosen === index" class="label">{{
                    group.status === "confirmed" ? "Chosen" : "Suggested"
                  }}</span>
                  <button
                    v-else
                    class="btn"
                    type="button"
                    :disabled="busy"
                    :aria-label="`Use this: ${candidate.title} (${candidate.year ?? 'year unknown'})`"
                    @click="run(() => api.choose(group!.key, index))"
                  >
                    Use this
                  </button>
                  <button
                    class="btn"
                    type="button"
                    aria-haspopup="dialog"
                    :aria-label="`Details of ${candidate.title} (${candidate.year ?? 'year unknown'})`"
                    @click="showDetails(idOf(candidate))"
                  >
                    Details
                  </button>
                </span>
              </div>
            </div>
          </div>
          <div class="fill">
            <div>
              <form
                v-if="pickedHere.length"
                class="row numbers movebar"
                aria-label="Move the selected files"
                @submit.prevent="move(false)"
                @keydown.esc="picked = []"
              >
                <strong>{{ pickedHere.length }} selected</strong>
                <label
                  >Move to
                  <select v-model="moveTo" class="input wide">
                    <option :value="NEW_GROUP">A new group</option>
                    <option v-for="item in others" :key="item.key" :value="item.key">
                      {{ nameOf(item) }}
                    </option>
                  </select></label
                >
                <button class="btn primary" type="submit" :disabled="busy">Move</button>
                <button class="btn quiet" type="button" @click="picked = []">
                  Clear selection
                </button>
              </form>
            </div>
            <div class="files scroll">
              <div class="file cols">
                <label class="pick label">
                  <input
                    v-if="canMove && group.files.length > 1"
                    type="checkbox"
                    aria-label="Select all files"
                    :checked="allPicked"
                    :indeterminate="pickedHere.length > 0 && !allPicked"
                    @change="pickAll(($event.target as HTMLInputElement).checked)"
                  />
                  {{ plural(group.files.length, "file")
                  }}<span v-if="problems" class="issue">
                    · {{ plural(problems, "problem") }}</span
                  >
                </label>
                <span class="label">Current name</span>
                <span class="label">New name</span>
              </div>
              <div
                v-for="file in group.files"
                :key="file.id"
                class="file"
                :data-file="file.id"
              >
                <span class="pick">
                  <input
                    v-if="canMove"
                    v-model="picked"
                    type="checkbox"
                    :value="file.id"
                    :aria-label="`Select ${file.source}`"
                  />
                  <button
                    v-if="group.kind === 'tv'"
                    class="ep"
                    type="button"
                    title="Change season or episode"
                    :aria-label="`${file.label}: change season or episode for ${file.source}`"
                    :aria-expanded="editing === file.id"
                    @click="edit(file)"
                  >
                    {{ file.label }}
                  </button>
                  <span v-else class="ep">{{ file.label }}</span>
                </span>
                <span class="path muted" :title="file.source"
                  ><span class="dir">{{ split(file.source)[0] }}</span
                  ><span class="base">{{ split(file.source)[1] }}</span></span
                >
                <span v-if="file.issue" class="issue">{{ file.issue }}</span>
                <span v-else-if="file.excluded"
                  ><span class="muted">Left out of the next batch. </span>
                  <button class="btn" type="button" @click="run(() => api.exclude(file.id, false))">
                    Include again
                  </button></span
                >
                <span v-else-if="file.target" class="path" :title="file.target"
                  ><span class="dir muted">{{ split(file.target)[0] }}</span
                  ><span class="base">{{ split(file.target)[1] }}</span></span
                >
                <span v-else class="muted">Appears once a match is chosen.</span>
                <form
                  v-if="editing === file.id"
                  class="row numbers edit"
                  :aria-label="`Season and episode for ${file.source}`"
                  @submit.prevent="saveNumbers(file.id)"
                  @keydown.esc="closeEdit(file.id)"
                >
                  <label
                    >Season
                    <input v-focus v-model="numbers.season" class="input" type="number" min="0" max="999" placeholder="none"
                  /></label>
                  <label
                    >Episode
                    <input v-model="numbers.episode" class="input" type="number" min="1" max="9999" required
                  /></label>
                  <label
                    ><span aria-hidden="true">to</span
                    ><span class="sr-only">Last episode, for a multi-episode file</span>
                    <input v-model="numbers.episodeEnd" class="input" type="number" min="2" max="9999" placeholder="single"
                  /></label>
                  <button class="btn primary" type="submit" :disabled="busy">Save</button>
                  <button class="btn quiet" type="button" @click="closeEdit(file.id)">Cancel</button>
                </form>
              </div>
            </div>
          </div>

          <div class="row">
            <button
              v-if="group.status !== 'confirmed' && match"
              class="btn primary"
              type="button"
              :disabled="busy"
              @click="confirmAndNext"
            >
              Confirm and next
            </button>
            <button v-else class="btn" type="button" @click="selectNext(group.key)">
              Next group
            </button>
            <button
              v-if="others.length && !merging"
              class="btn quiet"
              type="button"
              :disabled="store.busy"
              @click="startMerge"
            >
              Merge into another group
            </button>
            <button class="btn quiet" type="button" :disabled="store.busy" @click="remove">
              Remove from queue
            </button>
          </div>
          <form
            v-if="merging"
            class="row numbers"
            @submit.prevent="move(true)"
            @keydown.esc="merging = false"
          >
            <label
              >Merge all {{ plural(group.files.length, "file") }} into
              <select v-focus v-model="mergeTo" class="input wide">
                <option v-for="item in others" :key="item.key" :value="item.key">
                  {{ nameOf(item) }}
                </option>
              </select></label
            >
            <button class="btn primary" type="submit" :disabled="busy">Merge</button>
            <button class="btn quiet" type="button" @click="merging = false">Cancel</button>
          </form>
        </template>
        <p v-else class="muted">No groups in this view.</p>
      </SplitView>

      <div class="foot">
        <button class="btn" type="button" :disabled="store.busy" @click="run(api.clear)">
          Clear queue
        </button>
        <div class="row">
          <button
            v-if="suggested"
            class="btn"
            type="button"
            :disabled="store.busy"
            @click="confirmAll"
          >
            Confirm {{ suggested }} suggested
          </button>
          <button
            class="btn primary"
            type="button"
            :disabled="!readyFiles"
            @click="go('preview')"
          >
            Preview changes
          </button>
        </div>
      </div>
    <dialog
      ref="details"
      class="help facts"
      aria-labelledby="details-title"
      @close="detailed = null"
    >
      <template v-if="detail">
        <div class="about">
          <img
            v-if="detail.posterUrl && !broken.includes(idOf(detail))"
            class="poster"
            :src="thumb(detail.posterUrl)"
            alt=""
            referrerpolicy="no-referrer"
            @error="posterFailed($event, detail)"
          />
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
            <dd :class="{ mono: name === 'Page' || name.endsWith('ID') }">{{ value }}</dd>
          </template>
        </dl>
        <form class="row" method="dialog">
          <button
            v-if="group?.chosen !== detailedAt"
            class="btn primary"
            type="button"
            :disabled="busy"
            @click="useDetailed"
          >
            Use this
          </button>
          <button class="btn" type="submit">Close</button>
        </form>
      </template>
    </dialog>
  </div>
</template>
