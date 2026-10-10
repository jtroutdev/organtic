import test from "node:test";
import assert from "node:assert/strict";
import { makeNfo } from "../core/media.ts";
import {
  JELLYFIN_TEMPLATES,
  PLEX_TEMPLATES,
  renderTemplate,
  safeName,
  validateTemplate,
} from "../core/naming.ts";
import type { MediaLike } from "../core/types.ts";

const severance: MediaLike = {
  title: "Severance",
  year: 2022,
  kind: "tv",
  provider: "tmdb",
  id: 95396,
  season: 1,
  episode: 1,
  episodeTitle: "Good News About Hell",
};

test("portable filenames", () => {
  assert.equal(safeName("A: B / C?"), "A B C");
  assert.equal(safeName("CON"), "_CON");
  assert.throws(() => safeName("..."));
  assert.throws(() => safeName("界".repeat(80)), /too long/);
});

test("Plex templates render folders and multi-episode ranges", () => {
  assert.deepEqual(renderTemplate(PLEX_TEMPLATES.episode, severance), [
    "Severance (2022)",
    "Season 01",
    "Severance (2022) - S01E01 - Good News About Hell",
  ]);
  assert.equal(
    renderTemplate(PLEX_TEMPLATES.episode, {
      ...severance,
      season: 0,
      episode: 9,
      episodeEnd: 10,
      episodeTitle: "A & B",
    }).at(-1),
    "Severance (2022) - S00E09-E10 - A & B",
  );
  assert.deepEqual(
    renderTemplate(PLEX_TEMPLATES.movie, {
      title: "Face/Off",
      year: 1997,
      kind: "movie",
      provider: "tmdb",
      id: 754,
    }),
    ["Face Off (1997)", "Face Off (1997)"],
  );
});

test("missing values leave no empty brackets, tags or dangling separators", () => {
  // A TVmaze match has no TMDB ID, and this one has no year or episode title.
  assert.deepEqual(
    renderTemplate(PLEX_TEMPLATES.episode, {
      title: "Show",
      year: null,
      kind: "tv",
      provider: "tvmaze",
      id: 5,
      season: 12,
      episode: 100,
    }),
    ["Show", "Season 12", "Show - S12E100"],
  );
  assert.throws(
    () => renderTemplate(PLEX_TEMPLATES.episode, { title: "Show", kind: "tv" }),
    /requires/,
  );
});

test("custom templates are validated before use", () => {
  assert.deepEqual(validateTemplate("{title} - {season}x{episode:00}", "tv"), []);
  assert.deepEqual(
    renderTemplate("{title} - {season}x{episode:00}", severance),
    ["Severance - 1x01"],
  );
  assert.match(validateTemplate("{titel} ({year})", "movie").join(), /Unknown placeholder \{titel\}/);
  assert.match(validateTemplate("../{title}", "movie").join(), /dots/);
  assert.match(validateTemplate("/{title}", "movie").join(), /empty/);
  assert.match(validateTemplate("{title}\\{year}", "movie").join(), /backslash/);
  assert.match(validateTemplate("{title}/Season {season}", "tv").join(), /must include \{title\}/);
  assert.match(validateTemplate("{title} {season}", "tv").join(), /must include \{episode\}/);
  assert.throws(() => renderTemplate("{nope}", severance), /Unknown placeholder/);
});

test("NFO escapes only what XML requires and uses episode-level identifier", () => {
  const nfo = makeNfo({
    title: "A & B",
    kind: "tv",
    season: 1,
    episode: 1,
    episodeTitle: "<Pilot>",
    overview: `It's "Hello" & goodbye`,
    provider: "tvmaze",
    id: 5,
    episodeId: 9,
  });
  // Apostrophes and quotation marks are legal in XML text, so a description reads as written.
  assert.match(nfo, /<plot>It's "Hello" &amp; goodbye<\/plot>/);
  assert.match(nfo, /<title>&lt;Pilot&gt;<\/title>/);
  assert.match(nfo, /<showtitle>A &amp; B/);
  assert.match(nfo, />9<\/uniqueid>/);
  assert.match(nfo, /CC BY-SA/);
});

test("a match without a TMDB ID is tagged with its TVDB or IMDb ID", () => {
  // The Plex preset has no tag; this is the one a custom template can add.
  const TAGGED = "{title} ({year}) {{idsource}-{id}}/{title} S{season:00}E{episode:00}";
  const tvmaze: MediaLike = { ...severance, provider: "tvmaze", id: 44933, tvdbId: 371980, imdbId: "tt11280740" };
  const folder = (template: string, media: MediaLike) => renderTemplate(template, media)[0];
  assert.equal(folder(TAGGED, tvmaze), "Severance (2022) {tvdb-371980}");
  assert.equal(folder(TAGGED, { ...tvmaze, tvdbId: undefined }), "Severance (2022) {imdb-tt11280740}");
  assert.equal(folder(JELLYFIN_TEMPLATES.episode, tvmaze), "Severance (2022) [tvdbid-371980]");
  assert.equal(folder(JELLYFIN_TEMPLATES.episode, severance), "Severance (2022) [tmdbid-95396]");
  // A TMDB match keeps its TMDB tag even when other IDs are known.
  assert.equal(folder(TAGGED, { ...severance, tvdbId: 371980 }), "Severance (2022) {tmdb-95396}");
  // No usable ID at all, or one in an unexpected shape: no tag and no stray brackets.
  const none = { ...tvmaze, tvdbId: undefined, imdbId: "../etc" };
  assert.equal(folder(TAGGED, none), "Severance (2022)");
  assert.equal(folder(JELLYFIN_TEMPLATES.episode, none), "Severance (2022)");
  // The individual placeholders still work in custom templates.
  assert.deepEqual(renderTemplate("{title} [{tvdbid}] [{imdbid}] [{tmdbid}]", { ...tvmaze, kind: "movie" }), [
    "Severance [371980] [tt11280740]",
  ]);
});

test("templates can name episodes by the day they aired", () => {
  const dated: MediaLike = { ...severance, aired: "2022-02-18" };
  const byDate = "{title}/Season {season:00}/{title} - {airdate} - {episodeTitle}";
  assert.deepEqual(validateTemplate(byDate, "tv"), []);
  assert.deepEqual(renderTemplate(byDate, dated), [
    "Severance",
    "Season 01",
    "Severance - 2022-02-18 - Good News About Hell",
  ]);
  // Without a known date the placeholder drops out like any other.
  assert.equal(renderTemplate(byDate, severance).at(-1), "Severance - Good News About Hell");
  assert.equal(renderTemplate(byDate, { ...severance, aired: "soon/../x" }).at(-1), "Severance - Good News About Hell");
  assert.match(validateTemplate("{title} - {episodeTitle}", "tv").join(), /must include \{season\}/);
});
