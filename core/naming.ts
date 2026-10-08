import type { MediaKind, MediaLike, NamingTemplates } from "./types.ts";

/**
 * Plex's recommended layout. Folders are separated by "/"; the last segment is the
 * filename without its extension. Placeholders that have no value are dropped together
 * with their empty brackets, so a match with no known ID simply has no ID tag.
 *
 * `{idsource}` and `{id}` give the best ID the match has: TMDB, then TVDB, then IMDb.
 * A TVmaze match therefore gets a `{tvdb-…}` or `{imdb-…}` tag, which Plex also reads.
 */
export const PLEX_TEMPLATES: NamingTemplates = {
  movie: "{title} ({year}) {{idsource}-{id}}/{title} ({year})",
  episode:
    "{title} ({year}) {{idsource}-{id}}/Season {season:00}/{title} ({year}) - S{season:00}E{episode:00} - {episodeTitle}",
};

export const JELLYFIN_TEMPLATES: NamingTemplates = {
  movie: "{title} ({year}) [{idsource}id-{id}]/{title} ({year})",
  episode:
    "{title} ({year}) [{idsource}id-{id}]/Season {season:00}/{title} S{season:00}E{episode:00} {episodeTitle}",
};

export const PRESETS = { plex: PLEX_TEMPLATES, jellyfin: JELLYFIN_TEMPLATES };

export const PLACEHOLDERS = [
  "title",
  "year",
  "season",
  "episode",
  "episodeTitle",
  "airdate",
  "idsource",
  "id",
  "tmdbid",
  "tvdbid",
  "imdbid",
] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

const TOKEN = /\{([a-zA-Z]+)(?::(0+))?\}/g;
const isPlaceholder = (name: string): name is Placeholder =>
  (PLACEHOLDERS as readonly string[]).includes(name);

export function safeName(value: unknown): string {
  let name = String(value)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (!name || name === "." || name === "..")
    throw new Error("The filename is empty.");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    name = `_${name}`;
  // Leave room for extensions and sidecars on filesystems with a 255-byte limit.
  if (new TextEncoder().encode(name).length > 180)
    throw new Error("The generated name is too long. Use a shorter title.");
  return name;
}

/** Problems that would make a template unsafe or ambiguous; empty when it is usable. */
export function validateTemplate(template: string, kind: MediaKind): string[] {
  const errors: string[] = [];
  if (typeof template !== "string" || !template.trim() || template.length > 500)
    return ["Enter a naming template."];
  if (template.includes("\\"))
    errors.push('Use "/" to separate folders, not a backslash.');
  const segments = template.split("/");
  if (segments.length > 5) errors.push("Use at most four folder levels.");
  if (segments.some((segment) => !segment.trim() || /^\.+$/.test(segment.trim())))
    errors.push("Folder and file names cannot be empty or made only of dots.");
  for (const [, name = ""] of template.matchAll(TOKEN))
    if (!isPlaceholder(name)) errors.push(`Unknown placeholder {${name}}.`);
  const filename = segments.at(-1) ?? "";
  const has = (name: Placeholder) =>
    new RegExp(`\\{${name}(?::0+)?\\}`).test(filename);
  // An episode is identified by its numbers or, for a show named by date, by the day it aired.
  const required: Placeholder[] =
    kind === "tv" && !has("airdate")
      ? ["title", "season", "episode"]
      : ["title"];
  for (const name of required)
    if (!has(name)) errors.push(`The filename must include {${name}}.`);
  return errors;
}

/** Renders a template into safe path segments: zero or more folders, then the file stem. */
export function renderTemplate(template: string, media: MediaLike): string[] {
  if (!media?.title?.trim()) throw new Error("Choose a match first.");
  const errors = validateTemplate(template, media.kind);
  if (errors.length) throw new Error(errors.join(" "));
  const { season, episode, episodeEnd } = media;
  if (
    media.kind === "tv" &&
    (season === undefined ||
      !Number.isInteger(season) ||
      season < 0 ||
      episode === undefined ||
      !Number.isInteger(episode) ||
      episode < 1)
  )
    throw new Error("A TV match requires a season and episode number.");
  const pad = (value: number | undefined, zeros = "") =>
    value === undefined ? "" : String(value).padStart(zeros.length, "0");
  // Provider data ends up in folder names, so IDs are only used in their expected shape.
  const ids = {
    tmdb:
      media.provider === "tmdb" && media.id
        ? String(media.id)
        : Number.isInteger(media.tmdbId)
          ? String(media.tmdbId)
          : "",
    tvdb: Number.isInteger(media.tvdbId) ? String(media.tvdbId) : "",
    imdb: /^tt\d+$/.test(media.imdbId ?? "") ? media.imdbId! : "",
  };
  const best = (["tmdb", "tvdb", "imdb"] as const).find((source) => ids[source]);
  const values: Record<Placeholder, (zeros?: string) => string> = {
    title: () => media.title,
    year: () => (media.year ? String(media.year) : ""),
    season: (zeros) => pad(season, zeros),
    // Plex's multi-episode form: S01E01-E02.
    episode: (zeros) =>
      pad(episode, zeros) +
      (episodeEnd && episode && episodeEnd > episode
        ? `-E${pad(episodeEnd, zeros)}`
        : ""),
    episodeTitle: () => media.episodeTitle ?? "",
    airdate: () =>
      /^\d{4}-\d{2}-\d{2}$/.test(media.aired ?? "") ? media.aired! : "",
    idsource: () => best ?? "",
    id: () => (best ? ids[best] : ""),
    tmdbid: () => ids.tmdb,
    tvdbid: () => ids.tvdb,
    imdbid: () => ids.imdb,
  };
  // Split before substituting so a "/" inside a title cannot create a folder.
  return template.split("/").map((segment) =>
    safeName(
      segment
        .replace(TOKEN, (_whole, name: Placeholder, zeros?: string) =>
          values[name](zeros),
        )
        // Brackets and ID tags left empty by a missing value.
        .replace(/\(\s*\)|\[[a-z]*-?\s*\]|\{[a-z]*-?\s*\}/gi, "")
        .replace(/\s+/g, " ")
        // A missing value between two separators leaves " - - "; make it one.
        .replace(/(?: -)+ - /g, " - ")
        .replace(/^[\s-]+|[\s-]+$/g, ""),
    ),
  );
}
