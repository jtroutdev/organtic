<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  PLACEHOLDERS,
  PRESETS,
  renderTemplate,
  validateTemplate,
} from "../../core/naming.ts";
import type { MediaLike, NamingPreset } from "../../core/types.ts";
import ListItem from "../components/ListItem.vue";
import SplitView from "../components/SplitView.vue";
import { announce, api, run, saveSettings, store } from "../store.ts";
import tmdbLogo from "/tmdb-logo.svg";

const SAMPLES: Record<"movie" | "episode", MediaLike> = {
  movie: { kind: "movie", title: "Arrival", year: 2016, provider: "tmdb", id: 329865 },
  episode: {
    kind: "tv",
    title: "Severance",
    year: 2022,
    provider: "tmdb",
    id: 95396,
    season: 1,
    episode: 2,
    episodeEnd: 3,
    episodeTitle: "Half Loop & In Perpetuity",
  },
};
const LANGUAGES = [
  ["en-US", "English"],
  ["de-DE", "Deutsch"],
  ["es-ES", "Español"],
  ["fr-FR", "Français"],
  ["it-IT", "Italiano"],
  ["pt-BR", "Português (Brasil)"],
  ["ja-JP", "日本語"],
  ["ko-KR", "한국어"],
  ["zh-CN", "中文"],
];
const presets: [NamingPreset, string][] = [
  ["plex", "Plex"],
  ["jellyfin", "Jellyfin"],
  ["custom", "Custom"],
];
const toggles = [
  ["skipExtras", "Set samples, trailers and extras aside", "They stay listed under the queue and can be included by hand"],
  ["autoMatch", "Look up matches as soon as files are added", "Suggestions still wait for you to confirm them"],
  ["organize", "Organise into folders", "Off renames each file where it is"],
  ["subtitles", "Rename subtitles too", "Keeps language tags such as .en.forced"],
  ["sidecars", "Move existing NFO files and artwork", "Those named after a video, and a film or season folder's own poster, fanart and NFO"],
  ["nfo", "Write NFO metadata files", "Read by Kodi and Jellyfin, ignored by Plex"],
  ["removeEmpty", "Remove folders left empty after organising", "A folder that still holds anything is kept"],
  ["artwork", "Download posters and backdrops", "Saved as poster and fanart images in each title's folder; existing artwork is never replaced"],
] as const;

// Templates are edited as a draft and saved together, so a half-typed one is never used.
const draft = reactive({ ...store.settings.templates });
const preset = ref(store.settings.preset);
watch(
  () => store.settings,
  (settings) => {
    Object.assign(draft, settings.templates);
    preset.value = settings.preset;
  },
);
const fields = [
  ["movie", "Films", "movie"],
  ["episode", "TV episodes", "tv"],
] as const;
const errors = computed(() => ({
  movie: validateTemplate(draft.movie, "movie"),
  episode: validateTemplate(draft.episode, "tv"),
}));
const example = (key: "movie" | "episode") =>
  `${renderTemplate(draft[key], SAMPLES[key]).join("/")}.mkv`;
const dirty = computed(
  () =>
    draft.movie !== store.settings.templates.movie ||
    draft.episode !== store.settings.templates.episode,
);
const valid = computed(
  () => !errors.value.movie.length && !errors.value.episode.length,
);
function pick(id: NamingPreset) {
  preset.value = id;
  if (id !== "custom") {
    Object.assign(draft, PRESETS[id]);
    void saveSettings({ preset: id });
  }
}
const saveTemplates = () =>
  saveSettings({ preset: "custom", templates: { ...draft } });

const token = ref("");
async function setToken(value: string) {
  const sources = await run(() => api.setToken(value));
  if (sources) {
    store.sources = sources;
    announce(value ? "Token saved." : "Token removed.");
  }
  token.value = "";
}
const tvdbKey = ref("");
const tvdbPin = ref("");
async function setTvdbKey(key: string, pin: string) {
  const sources = await run(() => api.setTvdbKey(key, pin));
  if (!sources) return;
  store.sources = sources;
  announce(key ? "TVDB key saved." : "TVDB key removed.");
  tvdbKey.value = "";
  tvdbPin.value = "";
}
const NOTES = {
  saved: "Saved in your system keychain",
  session: "Kept until you quit",
  none: "Not set",
};
const tokenNote = computed(
  () =>
    ({
      saved: "Saved in your system keychain",
      session: "Kept until you quit",
      none: "No token set",
    })[store.sources.tmdb],
);
const sections = computed<[string, string, string, string][]>(() => [
  [
    "naming",
    "Naming",
    { plex: "Plex layout", jellyfin: "Jellyfin layout", custom: "Custom templates" }[
      store.settings.preset
    ],
    "ok",
  ],
  [
    "sources",
    "Sources",
    store.sources.tmdb === "none" ? "TVmaze and Kitsu" : "TMDB, TVmaze and Kitsu",
    store.sources.tmdb === "none" ? "warn" : "ok",
  ],
  ["behaviour", "Adding and renaming", "Defaults for every batch", "ok"],
]);
</script>

<template>
  <div class="page">
    <div class="above">
      <div class="head">
        <div>
          <h1>Settings</h1>
          <p>Saved on this computer and used for every batch.</p>
        </div>
      </div>
    </div>
    <SplitView :current="store.section" list="Settings sections" detail="Selected section">
      <template #side>
        <ListItem
          v-for="[id, name, note, tone] in sections"
          :key="id"
          :current="store.section === id"
          :tone="tone"
          :note="note"
          @click="store.section = id"
        >
          {{ name }}
        </ListItem>
      </template>

      <template v-if="store.section === 'naming'">
        <h2 class="title">Naming</h2>
        <div class="row">
          <span class="label">Preset</span>
          <div class="seg" role="group" aria-label="Preset">
            <button
              v-for="[id, label] in presets"
              :key="id"
              type="button"
              :aria-pressed="preset === id"
              @click="pick(id)"
            >
              {{ label }}
            </button>
          </div>
        </div>
        <template v-for="[key, label] in fields" :key="key">
          <label class="field"
            >{{ label }} template
            <input
              v-model="draft[key]"
              class="input mono"
              spellcheck="false"
              maxlength="500"
              @input="preset = 'custom'"
          /></label>
          <div class="example mono" aria-live="polite">
            <span class="sr-only">Example: </span>
            <span v-if="errors[key].length" class="issue bad">{{
              errors[key].join(" ")
            }}</span>
            <template v-else>{{ example(key) }}</template>
          </div>
        </template>
        <div v-if="preset === 'custom'" class="row">
          <button
            class="btn primary"
            type="button"
            :disabled="!valid || store.busy || (!dirty && store.settings.preset === 'custom')"
            @click="saveTemplates"
          >
            Save templates
          </button>
          <span v-if="dirty" class="muted">Not saved yet.</span>
        </div>
        <div>
          <h3 class="label" style="margin-bottom: 6px">Placeholders</h3>
          <div class="tokens">
            <code v-for="name in PLACEHOLDERS" :key="name" v-text="'{' + name + '}'"></code>
            <code>{season:00}</code>
          </div>
          <p class="muted" style="margin-top: 8px">
            “/” starts a folder. Add :00 to pad a number. A placeholder with no
            value is dropped along with its empty brackets. {idsource} and {id}
            give the best ID the match has: TMDB, then TVDB, then IMDb.
          </p>
        </div>
      </template>

      <template v-else-if="store.section === 'sources'">
        <h2 class="title">Sources</h2>
        <div>
          <h3 class="sub">The Movie Database</h3>
          <p class="muted">
            Films, shows and episode titles. Uses your own free API read access
            token.
            <button class="link" type="button" @click="api.openReference('token')">
              Get a token
            </button>
          </p>
        </div>
        <form class="row" @submit.prevent="setToken(token)">
          <input
            v-model="token"
            class="input"
            type="password"
            autocomplete="off"
            aria-label="TMDB API read access token"
            placeholder="Paste your TMDB token"
            style="flex: 1 1 220px; width: auto"
          />
          <button class="btn primary" type="submit" :disabled="!token.trim() || store.busy">
            Save token
          </button>
          <button
            v-if="store.sources.tmdb !== 'none'"
            class="btn"
            type="button"
            :disabled="store.busy"
            @click="setToken('')"
          >
            Remove
          </button>
        </form>
        <div class="row">
          <span class="pill" :class="store.sources.tmdb === 'none' ? 'off' : 'ok'">{{
            tokenNote
          }}</span>
          <span v-if="!store.sources.canSave" class="muted"
            >No system keychain is available, so the token is not stored and must
            be entered again next time.</span
          >
        </div>
        <p class="muted row">
          <img :src="tmdbLogo" alt="TMDB" height="12" />
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.
        </p>
        <div style="border-top: 1px solid var(--line); padding-top: 14px">
          <h3 class="sub">TVmaze</h3>
          <p class="muted">
            TV shows only. Needs no account, and is used for shows when no TMDB
            token is set. Data from
            <button class="link" type="button" @click="api.openReference('tvmaze')">
              TVmaze</button
            >, licensed
            <button class="link" type="button" @click="api.openReference('license')">
              CC BY-SA</button
            >.
          </p>
        </div>
        <div style="border-top: 1px solid var(--line); padding-top: 14px">
          <h3 class="sub">Kitsu</h3>
          <p class="muted">
            An anime catalogue with romaji, English and Japanese titles. Needs
            no account. It is searched only for groups set to Anime on Matching,
            where its results are offered beside the others. Each season or
            part is usually its own entry there.
          </p>
        </div>
        <label class="check">
          <input
            type="checkbox"
            :checked="store.settings.animeTitles"
            :disabled="store.busy"
            @change="saveSettings({ animeTitles: ($event.target as HTMLInputElement).checked })"
          />
          <span
            >Use Kitsu to find anime under their English titles<small
              >When a group searched as anime is not matched with confidence, every
              source is searched again under the other title Kitsu lists for it</small
            ></span
          >
        </label>
        <div style="border-top: 1px solid var(--line); padding-top: 14px">
          <h3 class="sub">TheTVDB <span class="muted">(optional)</span></h3>
          <p class="muted">
            Used only to title anime specials that are numbered as TVDB lists
            them, which no other source here can do. Needs your own v4 API key,
            and a subscriber PIN if your key requires one.
            <button class="link" type="button" @click="api.openReference('tvdb')">
              About TVDB keys
            </button>
          </p>
        </div>
        <form class="row" @submit.prevent="setTvdbKey(tvdbKey, tvdbPin)">
          <input
            v-model="tvdbKey"
            class="input"
            type="password"
            autocomplete="off"
            aria-label="TVDB API key"
            placeholder="Paste your TVDB API key"
            style="flex: 2 1 200px; width: auto"
          />
          <input
            v-model="tvdbPin"
            class="input"
            type="password"
            autocomplete="off"
            aria-label="TVDB subscriber PIN, if your key needs one"
            placeholder="PIN, if needed"
            style="flex: 1 1 120px; width: auto"
          />
          <button class="btn primary" type="submit" :disabled="!tvdbKey.trim() || store.busy">
            Check and save
          </button>
          <button
            v-if="store.sources.tvdb !== 'none'"
            class="btn"
            type="button"
            :disabled="store.busy"
            @click="setTvdbKey('', '')"
          >
            Remove
          </button>
        </form>
        <div class="row">
          <span class="pill" :class="store.sources.tvdb === 'none' ? 'off' : 'ok'">{{
            NOTES[store.sources.tvdb]
          }}</span>
          <span class="muted"
            >Metadata provided by TheTVDB. Please consider adding missing
            information or subscribing.</span
          >
        </div>
        <label class="check">
          <input
            type="checkbox"
            :checked="store.settings.animeSeasons"
            :disabled="store.busy"
            @change="saveSettings({ animeSeasons: ($event.target as HTMLInputElement).checked })"
          />
          <span
            >Place Kitsu matches in their TMDB or TVDB season<small
              >Off unless you turn it on. Downloads two community-maintained
              lists from GitHub the first time Kitsu is used as a source, and
              refreshes them weekly. Their terms of use are not stated</small
            ></span
          >
        </label>
        <label class="field"
          >Titles in
          <select
            class="input"
            :value="store.settings.language"
            @change="saveSettings({ language: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="[code, name] in LANGUAGES" :key="code" :value="code">
              {{ name }} ({{ code }})
            </option>
          </select></label
        >
      </template>

      <template v-else>
        <h2 class="title">Adding and renaming</h2>
        <label v-for="[key, label, note] in toggles" :key="key" class="check">
          <input
            type="checkbox"
            :checked="store.settings[key]"
            :disabled="store.busy"
            @change="saveSettings({ [key]: ($event.target as HTMLInputElement).checked })"
          />
          <span>{{ label }}<small>{{ note }}</small></span>
        </label>
      </template>
    </SplitView>
  </div>
</template>
