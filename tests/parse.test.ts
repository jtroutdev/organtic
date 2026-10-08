import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFilename,
  parseMediaPath,
  normalizeTitle,
} from "../core/parse.ts";
import type { ParsedName } from "../core/types.ts";

const pick = (parsed: ParsedName, ...keys: (keyof ParsedName)[]) =>
  Object.fromEntries(keys.map((key) => [key, parsed[key]]));

test("extracts movie title and year without release tags", () => {
  assert.deepEqual(parseFilename("Arrival.2016.1080p.BluRay.mkv"), {
    title: "Arrival",
    year: 2016,
    kind: "movie",
    season: null,
    episode: null,
    episodeEnd: null,
    airDate: null,
    releaseGroup: null,
    skip: null,
  });
  const cases: [string, string, number | null][] = [
    ["2001.A.Space.Odyssey.1968.mkv", "2001 A Space Odyssey", 1968],
    ["1917.2019.mkv", "1917", 2019],
    ["2012.mkv", "2012", null],
    ["Blade.Runner.2049.2017.2160p.UHD.mkv", "Blade Runner 2049", 2017],
    ["Blade Runner 2049 1080p.mkv", "Blade Runner 2049", null],
    ["Arrival (2016) [1080p] [x265].mp4", "Arrival", 2016],
    ["Rocky - 2.mkv", "Rocky - 2", null],
    ["300.mkv", "300", null],
  ];
  for (const [name, title, year] of cases)
    assert.deepEqual(
      pick(parseFilename(name), "title", "year", "kind"),
      { title, year, kind: "movie" },
      name,
    );
});

test("parses season and episode markers, including multi-episode files", () => {
  const cases: [string, string, number | null, number, number | null][] = [
    ["Severance.S01E02.1080p.mkv", "Severance", 1, 2, null],
    ["Show.2x03.mp4", "Show", 2, 3, null],
    ["Show.S01E01E02.mkv", "Show", 1, 1, 2],
    ["Show.S01E01-E03.720p.mkv", "Show", 1, 1, 3],
    ["Show.S01E05-06.mkv", "Show", 1, 5, 6],
    ["Show.S01E05-720p.mkv", "Show", 1, 5, null],
    ["Show.1x05-1x06.mkv", "Show", 1, 5, 6],
    ["Show (2019) - S02E10 - Title.mkv", "Show", 2, 10, null],
    ["Show.1920x1080.S03E04.mkv", "Show", 3, 4, null],
    ["Show Season 2 Episode 7.mkv", "Show", 2, 7, null],
  ];
  for (const [name, title, season, episode, episodeEnd] of cases)
    assert.deepEqual(
      pick(
        parseFilename(name),
        "title",
        "kind",
        "season",
        "episode",
        "episodeEnd",
      ),
      { title, kind: "tv", season, episode, episodeEnd },
      name,
    );
  assert.equal(parseFilename("Show (2019) - S02E10 - Title.mkv").year, 2019);
});

test("parses fansub-style names with absolute numbering", () => {
  const frieren = parseFilename(
    "[SubsPlease] Sousou no Frieren - 12 (1080p) [A1B2C3D4].mkv",
  );
  assert.deepEqual(frieren, {
    title: "Sousou no Frieren",
    year: null,
    kind: "tv",
    season: null,
    episode: 12,
    episodeEnd: null,
    airDate: null,
    releaseGroup: "SubsPlease",
    skip: null,
  });
  const cases: [string, string, number | null, number][] = [
    ["[Group] Show - 05v2 [720p].mkv", "Show", null, 5],
    ["[Group] Show S2 - 05 [1080p].mkv", "Show", 2, 5],
    ["[Group] Show Season 2 - 05.mkv", "Show", 2, 5],
    ["Show - 113 [1080p].mkv", "Show", null, 113],
    ["Show.E07.mkv", "Show", null, 7],
    ["Show Episode 7.mkv", "Show", null, 7],
    ["[Group] Show - 3.mkv", "Show", null, 3],
  ];
  for (const [name, title, season, episode] of cases)
    assert.deepEqual(
      pick(parseFilename(name), "title", "kind", "season", "episode"),
      { title, kind: "tv", season, episode },
      name,
    );
});

test("flags samples, trailers and extras without touching real titles", () => {
  assert.equal(parseFilename("arrival-sample.mkv").skip, "sample");
  assert.equal(parseFilename("Sample.mkv").skip, "sample");
  assert.equal(parseFilename("Arrival.2016-trailer.mp4").skip, "trailer");
  assert.equal(parseFilename("Extras.S01E01.mkv").skip, null);
  assert.equal(parseFilename("Resample.2020.mkv").skip, null);
  assert.equal(
    parseMediaPath("/lib/Arrival (2016)/Featurettes/Making Of.mkv", "/lib")
      .skip,
    "extra",
  );
});

test("fills gaps from season, show and release folders", () => {
  const cases: [string, Partial<ParsedName>][] = [
    [
      "/lib/Breaking Bad/Season 2/05 - Breakage.mkv",
      { title: "Breaking Bad", kind: "tv", season: 2, episode: 5 },
    ],
    [
      "/lib/Breaking Bad (2008)/Specials/01.mkv",
      { title: "Breaking Bad", year: 2008, season: 0, episode: 1 },
    ],
    [
      "/lib/Show.S02.1080p.WEB-DL-GRP/Show - 05.mkv",
      { title: "Show", season: 2, episode: 5 },
    ],
    [
      "/lib/Show/Season 3/Show - 07.mkv",
      { title: "Show", season: 3, episode: 7 },
    ],
    [
      "/lib/Show/S01E04 - Title.mkv",
      { title: "Show", season: 1, episode: 4 },
    ],
    [
      "/lib/Arrival.2016.1080p.BluRay.x264-GRP/grp-arrival.mkv",
      { title: "Arrival", year: 2016, kind: "movie" },
    ],
    [
      "/lib/Arrival (2016)/movie.mkv",
      { title: "Arrival", year: 2016, kind: "movie" },
    ],
    [
      "/lib/Oscars 2020/Parasite.mkv",
      { title: "Parasite", year: null, kind: "movie" },
    ],
  ];
  for (const [file, expected] of cases)
    assert.deepEqual(
      pick(
        parseMediaPath(file, "/lib"),
        ...(Object.keys(expected) as (keyof ParsedName)[]),
      ),
      expected,
      file,
    );
  // Folders above the import root are never used.
  assert.equal(parseMediaPath("/Show/Season 1/01.mkv", "/Show/Season 1").title, "");
});

test("normalizes titles for comparison", () => {
  assert.equal(normalizeTitle("Amélie"), "amelie");
  assert.equal(normalizeTitle("Law & Order: SVU"), "law and order svu");
});

test("reads the air date of episodes named by day", () => {
  const cases: [string, string, string | null, "tv" | "movie"][] = [
    ["The.Daily.Show.2024.03.15.Guest.Name.1080p.WEB.mkv", "The Daily Show", "2024-03-15", "tv"],
    ["Jeopardy - 2023-11-02 - Episode Title.mkv", "Jeopardy", "2023-11-02", "tv"],
    ["Late_Night_2022_01_31.mp4", "Late Night", "2022-01-31", "tv"],
    // A season and episode number wins over a date in the same name.
    ["Show.S02E05.2024.03.15.mkv", "Show", null, "tv"],
    // Not dates: a film's year, an impossible month, a title that starts with a year.
    ["Blade.Runner.2049.2017.mkv", "Blade Runner 2049", null, "movie"],
    ["Movie.2016.13.05.mkv", "Movie", null, "movie"],
    ["2012.mkv", "2012", null, "movie"],
  ];
  for (const [name, title, airDate, kind] of cases)
    assert.deepEqual(pick(parseFilename(name), "title", "airDate", "kind"), { title, airDate, kind }, name);
  const dated = parseFilename("The.Daily.Show.2024.03.15.mkv");
  // The date is not the show's year, and there is no number to mistake for an absolute one.
  assert.deepEqual(pick(dated, "year", "season", "episode"), { year: null, season: null, episode: null });
});

test("reads numbered specials from fansub-style names", () => {
  const cases: [string, string, number | null, number | null, "tv" | "movie"][] = [
    ["[Group] Show - OVA 02 [1080p].mkv", "Show", 0, 2, "tv"],
    ["[Group] Show SP1 [720p].mkv", "Show", 0, 1, "tv"],
    ["Show - Special 3.mkv", "Show", 0, 3, "tv"],
    ["Show - OAD 1 - Title.mkv", "Show", 0, 1, "tv"],
    // A numbered season and episode still wins.
    ["[Group] Show S01E05 OVA 2.mkv", "Show", 1, 5, "tv"],
    // Not specials: a film, and an untagged name with no dash before the word.
    ["Special.26.2013.1080p.mkv", "Special 26", null, null, "movie"],
    ["The.OVA.2.Collection.mkv", "The OVA 2 Collection", null, null, "movie"],
  ];
  for (const [name, title, season, episode, kind] of cases)
    assert.deepEqual(
      pick(parseFilename(name), "title", "season", "episode", "kind"),
      { title, season, episode, kind },
      name,
    );
});
