<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  Catalogue,
  MediaKind,
  ProviderName,
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
const kind = ref<MediaKind>("movie");
const provider = ref<ProviderName>("tmdb");
watch(
  () => [group.value?.key, group.value?.query, group.value?.kind, group.value?.provider],
  () => {
    if (!group.value) return;
    query.value = group.value.query;
    kind.value = group.value.kind;
    provider.value = group.value.provider;
  },
  { immediate: true },
);
watch(kind, (value) => {
  if (value === "movie" && provider.value === "tvmaze") provider.value = "tmdb";
});
const SOURCES = { tmdb: "TMDB", tvmaze: "TVmaze", kitsu: "Kitsu" };

// A candidate's description stays folded away until it is needed to tell two results apart.
const described = ref<string[]>([]);
const idOf = (candidate: { provider: string; id: unknown }) =>
  `${candidate.provider}-${candidate.id}`;
function describe(id: string) {
  described.value = described.value.includes(id)
    ? described.value.filter((item) => item !== id)
    : [...described.value, id];
}

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
// Closing the form removes the control that had focus; hand it back to the file's link.
function closeEdit(fileId: string) {
  editing.value = null;
  void focusOn(`[data-file="${fileId}"] .link`);
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
      provider: provider.value,
    }),
  );
</script>

<template>
  <div class="page">
    <template v-if="!store.queue.groups.length && !store.queue.skipped.length">
      <div class="above">
        <div class="head">
          <div>
            <h1>Review matches</h1>
            <p>Nothing in the queue.</p>
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
            @click="run(api.addFolder)"
          >
            Add folder
          </button>
          <button
            class="btn"
            type="button"
            :disabled="store.busy"
            @click="run(api.addFiles)"
          >
            Add files
          </button>
        </div>
      </div>
    </template>
    <template v-else>
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
            <button class="btn quiet" type="button" :disabled="store.busy" @click="run(api.clear)">
              Clear queue
            </button>
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
            class="link"
            type="button"
            @click="run(api.resetDestination)"
          >
            Use the added folder
          </button>
          <button class="link" type="button" @click="run(api.chooseDestination)">
            Change
          </button>
        </div>
      </div>

      <SplitView :current="group?.key" list="Groups" detail="Selected group" :aria-busy="group?.status === 'matching'">
        <template #head>
          <div class="chips">
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
        <template #side>
          <ListItem
            v-for="item in groups"
            :key="item.key"
            :current="item.key === group?.key"
            :tone="STATUS[item.status][0]"
            :note="STATUS[item.status][1]"
            :count="item.files.length"
            unit="files"
            @click="store.selected = item.key"
          >
            <template v-if="item.chosen != null">
              {{ item.candidates[item.chosen]?.title }}
              <span class="muted">({{ item.candidates[item.chosen]?.year ?? "year unknown" }})</span>
            </template>
            <template v-else>{{ item.parsedTitle || "Unnamed" }}</template>
          </ListItem>
        </template>

        <template v-if="group">
          <div class="row between">
            <div>
              <span class="kind">{{ group.kind === "tv" ? "TV" : "FILM" }}</span>
              <h2 class="title">
                {{ " " + (match?.title ?? (group.parsedTitle || "Unnamed")) }}
                <span v-if="match" class="muted">({{ match.year ?? "year unknown" }})</span>
              </h2>
            </div>
            <span class="pill" :class="STATUS[group.status][0]">{{
              STATUS[group.status][1]
            }}</span>
          </div>
          <p>
            <span class="muted"
              ><template v-if="match">read as “{{ group.parsedTitle }}” · </template
              >{{ plural(group.files.length, "file") }}
              <span v-if="problems" class="issue">
                · {{ plural(problems, "problem") }}</span
              >
              ·
            </span>
            {{ group.reason }}
          </p>

          <div class="fill">
            <h3 class="label" style="margin-bottom: 4px">Match</h3>
            <div class="cands scroll">
              <div
                v-for="(candidate, index) in group.candidates"
                :key="idOf(candidate)"
                class="cand"
                :class="{ on: group.chosen === index }"
              >
                <div class="row">
                  <span
                    ><strong>{{ candidate.title }}</strong>
                    <span class="muted"> ({{ candidate.year ?? "year unknown" }})</span></span
                  >
                  <span class="fit" :class="{ low: candidate.weak }">
                    {{ candidate.fit }} ·
                    {{ SOURCES[candidate.provider] }}
                  </span>
                  <button
                    class="link"
                    type="button"
                    :aria-expanded="described.includes(idOf(candidate))"
                    :aria-label="`Description of ${candidate.title} (${candidate.year ?? 'year unknown'})`"
                    @click="describe(idOf(candidate))"
                  >
                    {{ described.includes(idOf(candidate)) ? "Hide description" : "Description" }}
                  </button>
                </div>
                <span v-if="group.chosen === index" class="label">{{
                  group.status === "confirmed" ? "Chosen" : "Suggested"
                }}</span>
                <button
                  v-else
                  class="btn small"
                  type="button"
                  :disabled="busy"
                  :aria-label="`Use this: ${candidate.title} (${candidate.year ?? 'year unknown'})`"
                  @click="run(() => api.choose(group!.key, index))"
                >
                  Use this
                </button>
                <p v-if="described.includes(idOf(candidate))">
                  {{ candidate.overview || "No description available." }}
                </p>
              </div>
            </div>
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
              </div>
              <div class="seg" role="group" aria-label="Source">
                <button type="button" :aria-pressed="provider === 'tmdb'" @click="provider = 'tmdb'">
                  TMDB
                </button>
                <button
                  type="button"
                  :aria-pressed="provider === 'tvmaze'"
                  :disabled="kind === 'movie'"
                  @click="provider = 'tvmaze'"
                >
                  TVmaze
                </button>
                <button
                  type="button"
                  :aria-pressed="provider === 'kitsu'"
                  title="Anime catalogue"
                  @click="provider = 'kitsu'"
                >
                  Kitsu
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

          <div class="fill">
            <div>
              <div class="row between">
                <h3 class="label">Files</h3>
                <label v-if="canMove && group.files.length > 1" class="pick muted">
                  <input
                    type="checkbox"
                    :checked="allPicked"
                    @change="pickAll(($event.target as HTMLInputElement).checked)"
                  />
                  Select all
                </label>
              </div>
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
            <div class="scroll">
              <div
                v-for="file in group.files"
                :key="file.id"
                class="file"
                :data-file="file.id"
              >
                <label class="ep pick">
                  <input
                    v-if="canMove"
                    v-model="picked"
                    type="checkbox"
                    :value="file.id"
                    :aria-label="`Select ${file.source}`"
                  />
                  {{ file.label }}
                </label>
                <div>
                  <div class="mono muted">{{ file.source }}</div>
                  <form
                    v-if="editing === file.id"
                    class="row numbers"
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
                  <span v-else-if="file.issue" class="issue">{{ file.issue }}</span>
                  <template v-else-if="file.excluded">
                    <span class="muted">Left out of the next batch. </span>
                    <button class="link" type="button" @click="run(() => api.exclude(file.id, false))">
                      Include again
                    </button>
                  </template>
                  <span v-else-if="file.target" class="mono new">{{ file.target }}</span>
                  <span v-else class="muted">New name appears once a match is chosen.</span>
                  <div v-if="group.kind === 'tv' && editing !== file.id">
                    <button class="link" type="button" @click="edit(file)">
                      {{ file.numbers.episode === null ? "Set season and episode" : "Change season or episode" }}
                    </button>
                  </div>
                </div>
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

      <details v-if="store.queue.skipped.length" class="card">
        <summary>
          {{ plural(store.queue.skipped.length, "file") }} set aside as samples
          or extras
        </summary>
        <div class="scroll capped">
          <div v-for="file in store.queue.skipped" :key="file.id" class="row between">
            <span
              ><span class="mono">{{ file.source }}</span>
              <span class="pill off">{{ file.reason }}</span></span
            >
            <button class="btn" type="button" :disabled="store.busy" @click="run(() => api.include(file.id))">
              Include
            </button>
          </div>
        </div>
      </details>
    </template>
  </div>
</template>
