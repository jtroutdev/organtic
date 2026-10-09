import test from "node:test";
import assert from "node:assert/strict";
import { groupFiles, rankCandidates } from "../core/group.ts";
import { parseMediaPath } from "../core/parse.ts";
import type { Candidate, MediaFile } from "../core/types.ts";

const file = (relative: string): MediaFile => ({
  id: relative,
  path: `/lib/${relative}`,
  root: "/lib",
  name: relative.split("/").at(-1)!,
  size: 1,
  parsed: parseMediaPath(`/lib/${relative}`, "/lib"),
});
const candidate = (title: string, year: number | null, id = 1): Candidate => ({
  provider: "tmdb",
  kind: "movie",
  id,
  title,
  year,
  overview: "",
});

test("groups episodes by show across naming styles and sets extras aside", () => {
  const { groups, skipped } = groupFiles(
    [
      "Severance.S01E01.1080p.mkv",
      "severance.s01e02.720p.mkv",
      "Severance/Season 2/03 - Title.mkv",
      "[SubsPlease] Sousou no Frieren - 01 (1080p) [AAAA].mkv",
      "[SubsPlease] Sousou no Frieren - 02 (1080p) [BBBB].mkv",
      "Dune.1984.mkv",
      "Dune.2021.2160p.mkv",
      "Dune.2021.1080p.mkv",
      "Dune.2021.1080p-sample.mkv",
      "S01E01.mkv",
    ].map(file),
  );
  assert.deepEqual(
    groups.map((group) => [group.kind, group.title, group.year, group.fileIds.length]),
    [
      ["movie", "Dune", 1984, 1],
      ["movie", "Dune", 2021, 2],
      // A bare "S01E01.mkv" takes its title from the folder it was imported from.
      ["tv", "lib", null, 1],
      ["tv", "Severance", null, 3],
      ["tv", "Sousou no Frieren", null, 2],
    ],
  );
  assert.deepEqual(
    skipped.map((skippedFile) => skippedFile.name),
    ["Dune.2021.1080p-sample.mkv"],
  );
});

test("unnumbered files named after a show beside its episodes join that show", () => {
  const files = [
    "Simpsons/The Simpsons S08E11.avi",
    "Simpsons/The Simpsons 812 - Homer's Enemy.avi",
    "Simpsons/The Simpsons - Lisa the Vegetarian.avi",
    // Elsewhere, or with a year, a longer title is its own film.
    "Films/The Simpsons Movie.mkv",
    "Simpsons/The Simpsons Movie (2007).mkv",
  ].map(file);
  const { groups } = groupFiles(files);
  assert.deepEqual(
    groups.map((group) => [group.kind, group.title, group.fileIds.length]),
    [
      ["tv", "The Simpsons", 3],
      ["movie", "The Simpsons Movie", 1],
      ["movie", "The Simpsons Movie", 1],
    ],
  );
  assert.deepEqual(
    files.slice(1, 3).map(({ parsed }) => [parsed.season, parsed.episode, parsed.episodeTitle]),
    [
      [8, 12, "homer s enemy"],
      [null, null, "lisa the vegetarian"],
    ],
  );
});

test("ranks candidates and is confident only about a clear winner", () => {
  const dunes = [candidate("Dune", 1984, 1), candidate("Dune", 2021, 2), candidate("Dune: Part Two", 2024, 3)];
  const withYear = rankCandidates({ title: "Dune", year: 2021 }, dunes);
  assert.equal(withYear.ranked[0]!.candidate.id, 2);
  assert.equal(withYear.confident, true);

  // Two exact titles and no year to separate them: a person has to choose.
  const noYear = rankCandidates({ title: "Dune", year: null }, dunes);
  assert.equal(noYear.confident, false);
  assert.equal(noYear.ranked[0]!.candidate.id, 1);

  const accents = rankCandidates({ title: "Amelie", year: 2001 }, [candidate("Amélie", 2001)]);
  assert.equal(accents.confident, true);

  const loose = rankCandidates({ title: "The Office", year: null }, [candidate("Office Space", 1999)]);
  assert.equal(loose.confident, false);
  assert.deepEqual(rankCandidates({ title: "Dune", year: null }, []), { ranked: [], confident: false });

  // The same film from a second source is not a rival; a different film with that title is.
  const elsewhere: Candidate = { ...candidate("Dune", 2021, 9), provider: "kitsu" };
  const both = rankCandidates({ title: "Dune", year: 2021 }, [dunes[1]!, elsewhere, dunes[0]!]);
  assert.deepEqual(both.ranked.map((r) => r.candidate.provider), ["tmdb", "kitsu", "tmdb"]);
  assert.deepEqual([both.confident, both.rival?.candidate.year], [true, 1984]);
  assert.equal(rankCandidates({ title: "Dune", year: null }, [dunes[1]!, elsewhere]).confident, true);
  assert.equal(
    rankCandidates({ title: "Dune", year: null }, [dunes[1]!, { ...elsewhere, year: 1984 }]).confident,
    false,
  );
});
