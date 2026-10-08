import type { MediaLike } from "./types.ts";

export const VIDEO_EXTENSIONS = [
  "mkv",
  "mp4",
  "avi",
  "mov",
  "m4v",
  "wmv",
  "webm",
  "ts",
  "m2ts",
  "mpg",
  "mpeg",
];
export const SUBTITLE_EXTENSIONS = ["srt", "ass", "ssa", "vtt", "sub", "idx"];

const XML_ENTITIES: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  '"': "&quot;",
  "'": "&apos;",
};
const xml = (value: unknown) =>
  String(value ?? "").replace(/[<>&"']/g, (c) => XML_ENTITIES[c] ?? c);

export function makeNfo(media: MediaLike): string {
  const root = media.kind === "tv" ? "episodedetails" : "movie";
  const tags: Record<string, unknown> = {
    title: media.episodeTitle || media.title,
    year: media.year,
    plot: media.overview,
  };
  if (media.kind === "tv")
    Object.assign(tags, {
      showtitle: media.title,
      season: media.season,
      episode: media.episode,
      aired: media.aired,
    });
  const source =
    media.provider === "tvmaze"
      ? `TVmaze; source: ${media.sourceUrl || "https://www.tvmaze.com"}; data licensed CC BY-SA: https://creativecommons.org/licenses/by-sa/4.0/`
      : media.provider === "kitsu"
        ? `Kitsu; source: ${media.sourceUrl || "https://kitsu.app"}`
        : "TMDB; https://www.themoviedb.org";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<${root}>\n` +
    Object.entries(tags)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `  <${k}>${xml(v)}</${k}>`)
      .join("\n") +
    `\n  <uniqueid type="${xml(media.provider)}" default="true">${xml(media.episodeId || media.id)}</uniqueid>\n  <credits>${xml(source)}</credits>\n</${root}>\n`
  );
}
