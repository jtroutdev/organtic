import { PLEX_TEMPLATES, PRESETS, validateTemplate } from "./naming.ts";
import type { AppSettings } from "./types.ts";

export const DEFAULT_SETTINGS: AppSettings = {
  preset: "plex",
  templates: { ...PLEX_TEMPLATES },
  organize: true,
  subtitles: true,
  nfo: false,
  sidecars: true,
  removeEmpty: true,
  artwork: false,
  language: "en-US",
  skipExtras: true,
  autoMatch: true,
  animeTitles: true,
  // Off until asked for: it downloads community lists whose terms of use are unconfirmed.
  animeSeasons: false,
};

/**
 * Merges untrusted input (a settings file or a request from the interface) over `base`.
 * Unknown or wrongly typed fields are ignored; an unusable naming template is an error,
 * because silently reverting it would rename files differently from what was asked.
 */
export function mergeSettings(
  input: unknown,
  base: AppSettings = DEFAULT_SETTINGS,
): AppSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const flag = (
    key:
      | "organize"
      | "subtitles"
      | "nfo"
      | "sidecars"
      | "removeEmpty"
      | "artwork"
      | "skipExtras"
      | "autoMatch"
      | "animeTitles"
      | "animeSeasons",
  ) =>
    typeof raw[key] === "boolean" ? raw[key] : base[key];
  const preset =
    raw.preset === "plex" || raw.preset === "jellyfin" || raw.preset === "custom"
      ? raw.preset
      : base.preset;
  const given = (raw.templates ?? {}) as Record<string, unknown>;
  const templates =
    preset === "custom"
      ? {
          movie:
            typeof given.movie === "string" ? given.movie : base.templates.movie,
          episode:
            typeof given.episode === "string"
              ? given.episode
              : base.templates.episode,
        }
      : { ...PRESETS[preset] };
  const errors = [
    ...validateTemplate(templates.movie, "movie").map((e) => `Films: ${e}`),
    ...validateTemplate(templates.episode, "tv").map((e) => `TV episodes: ${e}`),
  ];
  if (errors.length) throw new Error(errors.join(" "));
  return {
    preset,
    templates,
    organize: flag("organize"),
    subtitles: flag("subtitles"),
    nfo: flag("nfo"),
    sidecars: flag("sidecars"),
    removeEmpty: flag("removeEmpty"),
    artwork: flag("artwork"),
    language:
      typeof raw.language === "string" &&
      /^[a-z]{2}(?:-[A-Z]{2})?$/.test(raw.language)
        ? raw.language
        : base.language,
    skipExtras: flag("skipExtras"),
    autoMatch: flag("autoMatch"),
    animeTitles: flag("animeTitles"),
    animeSeasons: flag("animeSeasons"),
  };
}
