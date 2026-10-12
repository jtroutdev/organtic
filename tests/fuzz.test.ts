import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFilename,
  parseMediaPath,
  normalizeTitle,
  titleSimilarity,
} from "../core/parse.ts";
import {
  PLEX_TEMPLATES,
  JELLYFIN_TEMPLATES,
  PLACEHOLDERS,
  renderTemplate,
  safeName,
  validateTemplate,
} from "../core/naming.ts";
import type { MediaLike, ParsedName } from "../core/types.ts";

// A fixed seed keeps a failure repeatable; FUZZ_SEED and FUZZ_RUNS widen the search by hand.
const SEED = Number(process.env.FUZZ_SEED ?? 20261012);
const RUNS = Number(process.env.FUZZ_RUNS ?? 3000);

/** mulberry32: small, fast and the same on every platform. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;
  return { next, int, pick };
}
type Random = ReturnType<typeof random>;

// The pieces real release names are made of, and the ones that have broken parsers before.
const WORDS = [
  "The", "Bear", "Arrival", "Dune", "Part", "Two", "2001", "1917", "Se7en", "Mr", "Robot",
  "Frieren", "S", "E", "x", "Season", "Episode", "Ep", "Specials", "OVA", "NCED", "v2",
  "S01E01", "s1e2", "S01E01E02", "S01E01-E03", "1x02", "102", "0102", "E05", "- 07", "#12",
  "2016", "(2016)", "[2016]", "1999", "2024-03-15", "2024.03.15", "15.03.2024",
  "1080p", "2160p", "720p", "x264", "x265", "HEVC", "BluRay", "WEB-DL", "HDR", "10bit",
  "[SubsPlease]", "[1A2B3C4D]", "-GRP", "sample", "trailer", "extras", "REPACK", "PROPER",
  "Ünïcödé", "東京", "Ａ", "é", "‮", "🎬", "İ", "ß",
  "CON", "nul", "com1", "..", "...", "~", "'", "&", "%20", "{title}", "$1",
];
const SEPARATORS = [".", " ", "_", "-", " - ", "", "  ", ".-.", "[", "]", "(", ")", "/", "\\"];
const EXTENSIONS = [".mkv", ".mp4", ".avi", ".srt", ".en.srt", "", ".", ".MKV", ".tar.gz"];
const CONTROL = ["\x00", "\x1f", "\x7f", "\n", "\t", "\r", ":", "*", "?", '"', "<", ">", "|"];

function releaseName(r: Random): string {
  let name = "";
  for (let i = r.int(9); i >= 0; i--) {
    const roll = r.next();
    name +=
      roll < 0.8
        ? r.pick(WORDS)
        : roll < 0.9
          ? String(r.int(100000))
          : roll < 0.95
            ? r.pick(CONTROL)
            : String.fromCodePoint(r.int(0x2fff));
    name += r.pick(SEPARATORS);
  }
  return name;
}
/** Long runs of one piece, the shape that makes a careless pattern backtrack for seconds. */
const repeated = (r: Random) =>
  (r.pick(WORDS) + r.pick(SEPARATORS)).repeat(200 + r.int(1800)) + r.pick(WORDS);

const KINDS = ["movie", "tv"];
const isCount = (value: number | null, least: number) =>
  value === null || (Number.isInteger(value) && value >= least);

function checkParsed(parsed: ParsedName, input: string) {
  const where = JSON.stringify(input);
  assert.equal(typeof parsed.title, "string", where);
  assert.ok(KINDS.includes(parsed.kind), where);
  assert.ok(isCount(parsed.season, 0), `season ${parsed.season} from ${where}`);
  assert.ok(isCount(parsed.episode, 0), `episode ${parsed.episode} from ${where}`);
  assert.ok(isCount(parsed.episodeEnd, 0), `episodeEnd ${parsed.episodeEnd} from ${where}`);
  assert.ok(isCount(parsed.year, 1), `year ${parsed.year} from ${where}`);
  if (parsed.episodeEnd !== null)
    assert.ok(parsed.episode !== null, `episodeEnd without episode from ${where}`);
  if (parsed.airDate !== null)
    assert.match(parsed.airDate, /^\d{4}-\d{2}-\d{2}$/, where);
}

test("parsing never throws and keeps its numbers whole on generated names", () => {
  const r = random(SEED);
  for (let i = 0; i < RUNS; i++) {
    const name = releaseName(r) + r.pick(EXTENSIONS);
    checkParsed(parseFilename(name), name);
    const folders = [releaseName(r), releaseName(r)].slice(0, 1 + r.int(2));
    const root = "/library";
    const full = [root, ...folders, name].join("/");
    checkParsed(parseMediaPath(full, root), full);
    const title = normalizeTitle(name);
    assert.equal(normalizeTitle(title), title, `normalizeTitle twice: ${JSON.stringify(name)}`);
    const score = titleSimilarity(name, releaseName(r));
    assert.ok(score >= 0 && score <= 1, `similarity ${score}`);
  }
});

test("parsing stays fast on long repetitive names", () => {
  const r = random(SEED + 1);
  for (let i = 0; i < 60; i++) {
    const name = repeated(r) + ".mkv";
    const started = performance.now();
    checkParsed(parseFilename(name), name.slice(0, 80));
    parseMediaPath(`/library/${name}/${name}`, "/library");
    normalizeTitle(name);
    const took = performance.now() - started;
    assert.ok(took < 1000, `${Math.round(took)} ms for ${JSON.stringify(name.slice(0, 80))}…`);
  }
});

const UNSAFE = /[<>:"/\\|?*\x00-\x1f\x7f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const REFUSALS = /The filename is empty\.|The generated name is too long\./;

function checkSafe(name: string, from: string) {
  const where = `${JSON.stringify(name)} from ${JSON.stringify(from)}`;
  assert.ok(name.length > 0, where);
  assert.doesNotMatch(name, UNSAFE, where);
  assert.doesNotMatch(name, /[. ]$|^ /, where);
  assert.doesNotMatch(name, RESERVED, where);
  assert.notEqual(name, "..", where);
  assert.equal(name, name.normalize("NFC"), where);
  assert.ok(new TextEncoder().encode(name).length <= 180, where);
}

test("a safe name is always usable as a file name on every platform, or refused", () => {
  const r = random(SEED + 2);
  for (let i = 0; i < RUNS; i++) {
    const input = i % 50 === 0 ? repeated(r) : releaseName(r);
    let name: string;
    try {
      name = safeName(input);
    } catch (error) {
      assert.match((error as Error).message, REFUSALS, JSON.stringify(input));
      continue;
    }
    checkSafe(name, input);
    assert.equal(safeName(name), name, `safeName twice: ${JSON.stringify(input)}`);
  }
});

function template(r: Random): string {
  let text = "";
  for (let i = r.int(8); i >= 0; i--) {
    const roll = r.next();
    text +=
      roll < 0.5
        ? `{${r.pick(PLACEHOLDERS)}${r.next() < 0.3 ? ":" + "0".repeat(1 + r.int(3)) : ""}}`
        : roll < 0.6
          ? "/"
          : roll < 0.7
            ? r.pick(["{", "}", "{nope}", "{title:x}", "\\", "..", "{{id}}", "()", "[]"])
            : r.pick(WORDS) + r.pick(SEPARATORS);
  }
  return text;
}

function mediaLike(r: Random): MediaLike {
  const kind = r.pick(["movie", "tv"] as const);
  const maybe = <T>(value: T) => (r.next() < 0.7 ? value : undefined);
  const media = {
    kind,
    title: r.next() < 0.05 ? " " : releaseName(r),
    year: maybe(r.pick([0, 1927, 2016, 2024, -1, 99999])),
    provider: r.pick(["tmdb", "tvmaze", "kitsu"] as const),
    id: r.pick([0, 1, 329865]),
    tmdbId: maybe(r.pick([603, 1.5, NaN])),
    tvdbId: maybe(r.pick([81189, -2.5, Infinity])),
    imdbId: maybe(r.pick(["tt0133093", "tt", "../../etc", "tt1/2", ""])),
    season: kind === "tv" || r.next() < 0.2 ? maybe(r.pick([0, 1, 12, -1, 1.5, NaN])) : undefined,
    episode: kind === "tv" || r.next() < 0.2 ? maybe(r.pick([1, 7, 1234, 0, -3, 2.5])) : undefined,
    episodeEnd: maybe(r.pick([2, 8, 0, -1])),
    episodeTitle: maybe(releaseName(r)),
    aired: maybe(r.pick(["2024-03-15", "2024/03/15", "../x", ""])),
  };
  return media as unknown as MediaLike;
}

test("a rendered template is one safe name per template segment, or refused", () => {
  const r = random(SEED + 3);
  const presets = [...Object.values(PLEX_TEMPLATES), ...Object.values(JELLYFIN_TEMPLATES)];
  let rendered = 0;
  for (let i = 0; i < RUNS; i++) {
    const media = mediaLike(r);
    const text = r.next() < 0.5 ? r.pick(presets) : template(r);
    for (const kind of ["movie", "tv"] as const)
      assert.ok(Array.isArray(validateTemplate(text, kind)), JSON.stringify(text));
    let segments: string[];
    try {
      segments = renderTemplate(text, media);
    } catch (error) {
      assert.ok(error instanceof Error, `threw a non-error for ${JSON.stringify(text)}`);
      assert.doesNotMatch(error.constructor.name, /TypeError|RangeError/, error.stack);
      continue;
    }
    rendered++;
    const where = `${JSON.stringify(text)} with ${JSON.stringify(media)}`;
    // Nothing in the match, such as "/" or ".." in a title, adds or removes a folder level.
    assert.equal(segments.length, text.split("/").length, where);
    assert.deepEqual(validateTemplate(text, media.kind), [], where);
    for (const segment of segments) checkSafe(segment, where);
  }
  assert.ok(rendered > RUNS / 10, `only ${rendered} of ${RUNS} rendered; the generator is too hostile`);
});

test("an episode named by a preset reads back as the same episode", () => {
  const r = random(SEED + 4);
  const titles = ["Severance", "The Bear", "Mr. Robot", "Frieren: Beyond Journey's End", "東京 Story", "Dark"];
  for (let i = 0; i < RUNS; i++) {
    const season = r.int(30);
    const episode = 1 + r.int(200);
    const double = r.next() < 0.2;
    const media = {
      kind: "tv",
      title: r.pick(titles),
      year: r.pick([1999, 2016, 2022]),
      provider: "tmdb",
      id: 1 + r.int(99999),
      season,
      episode,
      episodeEnd: double ? episode + 1 : undefined,
      episodeTitle: r.next() < 0.8 ? r.pick(["Pilot", "Half Loop", "Fishes", "7 Minutes", "Part 2"]) : undefined,
    } as unknown as MediaLike;
    for (const preset of [PLEX_TEMPLATES, JELLYFIN_TEMPLATES]) {
      const segments = renderTemplate(preset.episode, media);
      const full = ["/library", ...segments].join("/") + ".mkv";
      const parsed = parseMediaPath(full, "/library");
      const got = { kind: parsed.kind, season: parsed.season, episode: parsed.episode, episodeEnd: parsed.episodeEnd };
      assert.deepEqual(
        got,
        { kind: "tv", season, episode, episodeEnd: double ? episode + 1 : null },
        full,
      );
    }
  }
});
