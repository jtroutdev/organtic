import test from "node:test";
import assert from "node:assert/strict";
import { AnimeMap, buildIndex, parseExceptions, placeEpisode } from "../core/animeMap.ts";
import { renderTemplate } from "../core/naming.ts";
import { Providers } from "../core/providers.ts";
import type { Candidate, ResolveResult } from "../core/types.ts";

// Plex's optional ID tag, which the preset leaves out; here it shows which catalogue's ID was used.
const TAGGED = {
  movie: "{title} ({year}) {{idsource}-{id}}/{title} ({year})",
  episode:
    "{title} ({year}) {{idsource}-{id}}/Season {season:00}/{title} ({year}) - S{season:00}E{episode:00} - {episodeTitle}",
};

// Entries shaped like the community list, plus some that must be ignored.
const LIST = [
  { kitsu_id: 46474, tvdb_id: 424536, themoviedb_id: { tv: 209867 }, imdb_id: ["tt22248376"], season: { tvdb: 1, tmdb: 1 } },
  // A second season that TMDB lists as a continuation of the first.
  { kitsu_id: 49240, tvdb_id: 424536, themoviedb_id: { tv: 209867 }, season: { tvdb: 2, tmdb: 1 }, episode_offset: { tmdb: 28 } },
  // A second part: twelve episodes into season 3 in both catalogues.
  { kitsu_id: 41982, tvdb_id: 267440, themoviedb_id: { tv: 1429 }, season: { tvdb: 3, tmdb: 3 }, episode_offset: { tvdb: 12, tmdb: 12 } },
  { kitsu_id: 7442, tvdb_id: 267440, themoviedb_id: { tv: 1429 }, season: { tvdb: 1, tmdb: 1 } },
  { kitsu_id: 7441, tvdb_id: 267440, themoviedb_id: { tv: 1429 }, season: { tvdb: 0, tmdb: 0 } },
  { kitsu_id: 500, tvdb_id: 999, season: { tvdb: 4 }, episode_offset: { tvdb: 2 } },
  // A film whose TMDB number happens to equal a show's.
  { kitsu_id: 800, themoviedb_id: { movie: [1429] } },
  { kitsu_id: 11614, themoviedb_id: { movie: [372058] }, imdb_id: ["tt5311514"] },
  { kitsu_id: 600, tvdb_id: "../../etc", themoviedb_id: { tv: -5 }, imdb_id: ["nope"], season: { tmdb: 1.5 } },
  { kitsu_id: "700", tvdb_id: 1 },
  { anidb_id: 1, tvdb_id: 1 },
  null,
];
// Each show's first entry, as Kitsu would describe it.
const FIRST: Record<string, object> = {
  "46474": { canonicalTitle: "Sousou no Frieren", titles: { en: "Frieren" }, startDate: "2023-09-29", posterImage: { original: "https://media.kitsu.app/frieren.jpg" } },
  "7442": { canonicalTitle: "Attack on Titan", titles: {}, startDate: "2013-04-07", posterImage: { original: "https://media.kitsu.app/titan.jpg" } },
};
const kitsuApi = async (url: URL) =>
  /\/anime\/\d+$/.test(url.pathname)
    ? FIRST[url.pathname.split("/").at(-1)!]
      ? Response.json({ data: { id: url.pathname.split("/").at(-1), attributes: FIRST[url.pathname.split("/").at(-1)!] } })
      : new Response("", { status: 404 })
    : url.pathname.endsWith("/episodes")
    ? Response.json({
        data: Array.from({ length: 12 }, (_, index) => ({ attributes: { number: index + 1, canonicalTitle: `Part ${index + 1}` } })),
      })
    : Response.json({ data: [] });
const entry = (id: number, kind: "tv" | "movie" = "tv", extra: Partial<Candidate> = {}): Candidate => ({
  provider: "kitsu", kind, id, title: "Entry", year: 2020, overview: "", ...extra,
});
// Shaped like the upstream XML: runs, single episodes, an episode with no counterpart,
// one spanning two, catalogue-specific rules, specials (ignored) and junk (skipped).
const XML = `<?xml version="1.0"?>
<anime-list>
  <anime anidbid="900" tvdbid="5000" defaulttvdbseason="1" episodeoffset="" tmdbtv="6000" tmdbseason="1" tmdboffset="">
    <name>Long Runner</name>
    <mapping-list>
      <mapping anidbseason="0" tvdbseason="0">;1-0;2-5;3-6;4-9+10;6-11;</mapping>
      <mapping anidbseason="0" tvdbseason="1" start="7" end="8" offset="20"/>
      <mapping anidbseason="0" tmdbseason="0">;2-3;</mapping>
      <mapping anidbseason="1" tvdbseason="0">;9-1;18-2+3;20-0;</mapping>
      <mapping anidbseason="1" tvdbseason="1" start="10" end="17" offset="-1"/>
      <mapping anidbseason="1" tvdbseason="2" start="27" end="52" offset="-26"/>
      <mapping anidbseason="1" tmdbseason="2" start="14" end="26" offset="-13"/>
      <mapping anidbseason="1" tvdbseason="1" start="3" end="5" offset="-9"/>
      <mapping anidbseason="1" tvdbseason="x" start="1" end="2" offset="0"/>
    </mapping-list>
  </anime>
  <anime anidbid="901" tvdbid="5001" defaulttvdbseason="1"><name>Plain</name></anime>
  <anime anidbid="oops" tvdbid="1"><mapping-list><mapping anidbseason="1" tvdbseason="1" start="1" end="2" offset="5"/></mapping-list></anime>
</anime-list>`;
const names = (results: ResolveResult[]) =>
  results.map((result) => ("media" in result ? renderTemplate(TAGGED.episode, result.media).join("/") : result.error));

test("the list is reduced to checked numbers keyed by Kitsu ID", () => {
  const index = buildIndex(LIST);
  assert.deepEqual(Object.keys(index).sort(), ["11614", "41982", "46474", "49240", "500", "7441", "7442", "800"]);
  assert.deepEqual(index[41982], {
    tmdbId: 1429, tmdbSeason: 3, tmdbOffset: 12, tvdbId: 267440, tvdbSeason: 3, tvdbOffset: 12, imdbId: undefined,
  });
  assert.deepEqual([index[11614]!.tmdbId, index[11614]!.imdbId], [372058, "tt5311514"]);
  assert.throws(() => buildIndex({ not: "a list" }), /expected form/);
});

test("Kitsu entries are placed in their TMDB or TVDB season", async () => {
  const providers = new Providers({
    fetcher: kitsuApi,
    animeMap: new AnimeMap({ fetcher: (async () => Response.json(LIST)) as typeof fetch }),
  });
  const five = [{ season: null, episode: 5 }];
  const place = async (id: number, extra: Partial<Candidate> = {}) => (names(await providers.resolveMany(entry(id, "tv", extra), five)))[0];
  assert.equal(await place(46474), "Entry (2020) {tmdb-209867}/Season 01/Entry (2020) - S01E05 - Part 5");
  // TMDB's numbering and tag are used together, even though TVDB calls this season 2.
  // Later seasons and parts are filed under the show's own name and year, taken from its first entry.
  assert.equal(await place(49240), "Frieren (2023) {tmdb-209867}/Season 01/Frieren (2023) - S01E33 - Part 5");
  assert.equal(await place(41982), "Attack on Titan (2013) {tmdb-1429}/Season 03/Attack on Titan (2013) - S03E17 - Part 5");
  // The show's poster is its first entry's; this entry's own becomes the season poster.
  const [part] = await providers.resolveMany(entry(41982, "tv", { posterUrl: "https://media.kitsu.app/part2.jpg" }), five);
  assert.ok("media" in part!);
  assert.deepEqual(
    [part.media.posterUrl, part.media.seasonPosterUrl],
    ["https://media.kitsu.app/titan.jpg", "https://media.kitsu.app/part2.jpg"],
  );
  // Only TVDB knows this one, so its numbers come with a TVDB tag.
  assert.equal(await place(500), "Entry (2020) {tvdb-999}/Season 04/Entry (2020) - S04E07 - Part 5");
  // Not in the list: Kitsu's own mapping, then what the file claims.
  assert.equal(await place(1, { tvdbId: 267440, tvdbSeason: 2 }), "Entry (2020) {tvdb-267440}/Season 02/Entry (2020) - S02E05 - Part 5");
  assert.deepEqual(names(await providers.resolveMany(entry(2), [{ season: 3, episode: 5, episodeEnd: 6 }])), [
    "Entry (2020)/Season 03/Entry (2020) - S03E05-E06 - Part 5 & Part 6",
  ]);
  // A range keeps its length after the offset.
  assert.match(names(await providers.resolveMany(entry(41982), [{ season: null, episode: 1, episodeEnd: 2 }]))[0]!, /S03E13-E14/);
  // Asked for TVDB numbering, the same entry is season 2 there, tagged to match, and still
  // filed under the show's name. An entry TVDB cannot place falls back to TMDB's.
  const asTvdb = async (id: number) =>
    names(await providers.resolveMany(entry(id), five, "en-US", null, "tvdb"))[0];
  assert.equal(await asTvdb(49240), "Frieren (2023) {tvdb-424536}/Season 02/Frieren (2023) - S02E05 - Part 5");
  assert.equal(await asTvdb(41982), "Attack on Titan (2013) {tvdb-267440}/Season 03/Attack on Titan (2013) - S03E17 - Part 5");
  assert.equal(await asTvdb(500), "Entry (2020) {tvdb-999}/Season 04/Entry (2020) - S04E07 - Part 5");
  // Specials are never taken as a show's first entry, and a film is not part of a show.
  const map = new AnimeMap({ fetcher: (async () => Response.json(LIST)) as typeof fetch });
  assert.equal(await map.firstEntry(41982, "tmdb"), 7442);
  assert.equal(await map.firstEntry(7441, "tvdb"), 7442);
  assert.equal(await map.firstEntry(500, "tvdb"), 500);
  assert.equal(await map.firstEntry(500, "tmdb"), null);
  assert.equal(await map.firstEntry(800, "tmdb"), null);
  assert.equal(await map.firstEntry(123456, "tmdb"), null);
  // Films get their TMDB tag.
  const [film] = await providers.resolveMany(entry(11614, "movie"), [{ season: null, episode: 1 }]);
  assert.ok("media" in film!);
  assert.deepEqual(renderTemplate(TAGGED.movie, film.media), ["Entry (2020) {tmdb-372058}", "Entry (2020)"]);
});

test("per-episode exceptions are read and applied before the season default", async () => {
  const exceptions = parseExceptions(XML);
  assert.deepEqual([...exceptions.keys()], [900]);
  assert.deepEqual(exceptions.get(900), {
    tvdb: [
      { season: 0, episodes: { 9: [1], 18: [2, 3], 20: [] } },
      { season: 1, start: 10, end: 17, offset: -1 },
      { season: 2, start: 27, end: 52, offset: -26 },
    ],
    tmdb: [{ season: 2, start: 14, end: 26, offset: -13 }],
    tvdbSpecials: [
      { season: 0, episodes: { 1: [], 2: [5], 3: [6], 4: [9, 10], 6: [11] } },
      { season: 1, start: 7, end: 8, offset: 20 },
    ],
    tmdbSpecials: [{ season: 0, episodes: { 2: [3] } }],
  });
  // With no fallback, an episode no rule covers is simply unknown.
  assert.equal(placeEpisode(5, exceptions.get(900)!.tvdbSpecials), undefined);
  assert.equal(placeEpisode(1, exceptions.get(900)!.tvdbSpecials), null);
  const tvdb = exceptions.get(900)!.tvdb;
  const at = (n: number) => placeEpisode(n, tvdb, { season: 1, offset: 0 });
  assert.deepEqual(at(8), { season: 1, numbers: [8] });
  assert.deepEqual(at(9), { season: 0, numbers: [1] });
  assert.deepEqual(at(10), { season: 1, numbers: [9] });
  assert.deepEqual(at(18), { season: 0, numbers: [2, 3] });
  assert.equal(at(20), null);
  assert.deepEqual(at(30), { season: 2, numbers: [4] });
  assert.deepEqual(placeEpisode(5, undefined, { season: 3, offset: 12 }), { season: 3, numbers: [17] });

  // Through the provider, for an entry known only to TVDB and one TMDB also knows.
  const list = [
    { kitsu_id: 1, anidb_id: 900, tvdb_id: 5000, season: { tvdb: 1 } },
    { kitsu_id: 2, anidb_id: 900, tvdb_id: 5000, themoviedb_id: { tv: 6000 }, season: { tvdb: 1, tmdb: 1 } },
    // An entry that is itself a set of specials, three into the catalogue's season 0.
    { kitsu_id: 4, anidb_id: 900, tvdb_id: 5000, season: { tvdb: 0 }, episode_offset: { tvdb: 3 } },
  ];
  const providers = new Providers({
    fetcher: async (url) =>
      url.pathname.endsWith("/episodes")
        ? Response.json({
            data: Array.from({ length: 20 }, (_, index) => {
              const number = Number(url.searchParams.get("page[offset]")) + index + 1;
              return { attributes: { number, canonicalTitle: `Part ${number}` } };
            }),
          })
        : new Response("", { status: 404 }),
    animeMap: new AnimeMap({
      fetcher: (async (address: string) =>
        address.endsWith(".xml") ? new Response(XML) : Response.json(list)) as typeof fetch,
    }),
  });
  const short = (results: ResolveResult[]) =>
    results.map((result) =>
      "media" in result
        ? `S${result.media.season}E${result.media.episode}${result.media.episodeEnd ? `-${result.media.episodeEnd}` : ""} ${result.media.episodeTitle}`
        : result.error.split(".")[0],
    );
  const ask = (id: number, ...numbers: [number, number?][]) =>
    providers.resolveMany(entry(id), numbers.map(([episode, episodeEnd]) => ({ season: null, episode, episodeEnd })));
  assert.deepEqual(short(await ask(1, [8], [9], [10], [18], [20], [30], [10, 11], [8, 9], [8, 10])), [
    "S1E8 Part 8",
    "S0E1 Part 9",
    "S1E9 Part 10",
    "S0E2-3 Part 18",
    "Episode 20 of this entry has no counterpart in the catalogue",
    "S2E4 Part 30",
    "S1E9-10 Part 10 & Part 11",
    // A recap moved to specials sits between them, so no single name covers the file.
    "These episodes are not next to each other in the catalogue, so one file cannot be named for them",
    "These episodes are not next to each other in the catalogue, so one file cannot be named for them",
  ]);
  // Files marked as specials are the entry's own specials, placed by their own rules.
  const special = (id: number, ...numbers: [number, number?][]) =>
    providers.resolveMany(entry(id), numbers.map(([episode, episodeEnd]) => ({ season: 0, episode, episodeEnd })));
  assert.deepEqual(short(await special(1, [2], [2, 3], [4], [7], [1], [5], [3, 4], [6, 7])), [
    "S0E5 ",
    "S0E5-6 ",
    "S0E9-10 ",
    // One the catalogue counts as a regular episode.
    "S1E27 ",
    "Special 1 of this entry has no counterpart in the catalogue",
    "The mapping does not say where special 5 of this entry belongs",
    "These specials are not next to each other in the catalogue, so one file cannot be named for them",
    "These specials are in different seasons of the catalogue, so one file cannot be named for them",
  ]);
  // The same entry numbered as TVDB lists it brings TVDB's rules for its specials into play.
  assert.deepEqual(
    short(await providers.resolveMany(entry(2), [2, 3, 4].map((episode) => ({ season: 0, episode })), "en-US", null, "tvdb")),
    ["S0E5 ", "S0E6 ", "S0E9-10 "],
  );
  // With a TMDB token, a special placed in TMDB's numbering takes TMDB's title for that slot.
  const asked: string[] = [];
  const titled = new Providers({
    fetcher: async (url) => {
      if (url.hostname !== "api.themoviedb.org") return new Response("", { status: 404 });
      asked.push(url.pathname.replace("/3/", ""));
      return Response.json({
        episodes: [
          { id: 1, episode_number: 3, name: "Picture Drama", air_date: "2014-01-01", overview: "A short." },
          { id: 2, episode_number: 4, name: "Recap" },
        ],
      });
    },
    animeMap: new AnimeMap({
      fetcher: (async (address: string) =>
        address.endsWith(".xml")
          ? new Response(XML.replace(';2-3;', ';2-3;5-3+4;6-9;'))
          : Response.json(list)) as typeof fetch,
    }),
  });
  const specials = (provider: Providers) =>
    provider.resolveMany(entry(2), [2, 5, 6].map((episode) => ({ season: 0, episode })));
  // Without a token nothing is asked and the names carry numbers only.
  assert.deepEqual(short(await specials(titled)), ["S0E3 ", "S0E3-4 ", "S0E9 "]);
  assert.deepEqual(asked, []);
  titled.setToken("test");
  const results = await specials(titled);
  // A slot TMDB does not list keeps its number without a guessed title.
  assert.deepEqual(short(results), ["S0E3 Picture Drama", "S0E3-4 Picture Drama & Recap", "S0E9 "]);
  assert.ok("media" in results[0]! && results[0].media.aired === "2014-01-01" && results[0].media.overview === "A short.");
  // One request for the season, shared by every file.
  assert.deepEqual(asked, ["tv/6000/season/0"]);
  // TVDB-numbered specials are not looked up on TMDB, whose specials are numbered differently.
  asked.length = 0;
  assert.deepEqual(short(await titled.resolveMany(entry(1), [{ season: 0, episode: 2 }])), ["S0E5 "]);
  assert.deepEqual(asked, []);

  // With a TVDB key, specials numbered as TVDB lists them take TVDB's titles.
  const tvdbCalls: string[] = [];
  let signIns = 0, validKey = true;
  const withTvdb = new Providers({
    fetcher: async (url, init) => {
      if (url.hostname !== "api4.thetvdb.com") return new Response("", { status: 404 });
      if (url.pathname === "/v4/login") {
        signIns++;
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(String(init.body)), { apikey: "key-123", pin: "4321" });
        return validKey ? Response.json({ status: "success", data: { token: "session-token" } }) : Response.json({ status: "failure" }, { status: 401 });
      }
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer session-token");
      tvdbCalls.push(`${url.pathname.replace("/v4/", "")}?${url.searchParams}`);
      return Response.json({
        status: "success",
        data: { episodes: [
          { id: 51, seasonNumber: 0, number: 5, name: "Chibi Theater", aired: "2013-07-17", overview: "Shorts." },
          { id: 52, seasonNumber: 0, number: 6, name: null },
          { id: 53, seasonNumber: 0, number: 9, name: "Part A" },
          { id: 54, seasonNumber: 0, number: 10, name: "Part B" },
          // A different season's episode with a matching number must not be used.
          { id: 99, seasonNumber: 1, number: 6, name: "Wrong Season" },
        ] },
      });
    },
    animeMap: new AnimeMap({
      fetcher: (async (address: string) => (address.endsWith(".xml") ? new Response(XML) : Response.json(list))) as typeof fetch,
    }),
  });
  const tvdbSpecials = () => withTvdb.resolveMany(entry(1), [2, 3, 4].map((episode) => ({ season: 0, episode })), "de-DE");
  assert.deepEqual(short(await tvdbSpecials()), ["S0E5 ", "S0E6 ", "S0E9-10 "]);
  assert.equal(signIns, 0);
  withTvdb.setTvdbKey(" key-123 ", "4321");
  await withTvdb.checkTvdbKey();
  const named = await tvdbSpecials();
  // One with no name in that language keeps its number alone.
  assert.deepEqual(short(named), ["S0E5 Chibi Theater", "S0E6 ", "S0E9-10 Part A & Part B"]);
  assert.ok("media" in named[0]! && named[0].media.aired === "2013-07-17");
  // One sign-in and one listing for the season, in the language asked for.
  assert.equal(signIns, 1);
  assert.deepEqual(tvdbCalls, ["series/5000/episodes/default/deu?season=0&page=0"]);
  // An entry numbered as TMDB lists it is never looked up on TVDB.
  await withTvdb.resolveMany(entry(2), [{ season: 0, episode: 2 }]);
  assert.equal(tvdbCalls.length, 1);
  // A rejected key says so, and is not remembered as signed in.
  validKey = false;
  withTvdb.setTvdbKey("key-123", "4321");
  await assert.rejects(withTvdb.checkTvdbKey(), /TVDB rejected that key/);
  validKey = true;
  await withTvdb.checkTvdbKey();
  withTvdb.setTvdbKey("");
  assert.equal(withTvdb.hasTvdbKey, false);
  await assert.rejects(withTvdb.checkTvdbKey(), /No TVDB key/);

  // A mapped entry with no rules for its specials reports them; it never borrows a regular episode's number.
  const plain = new Providers({
    fetcher: kitsuApi,
    animeMap: new AnimeMap({ fetcher: (async (address: string) => (address.endsWith(".xml") ? new Response("") : Response.json(LIST))) as typeof fetch }),
  });
  assert.deepEqual(short(await plain.resolveMany(entry(41982), [{ season: 0, episode: 1 }, { season: 1, episode: 1 }])), [
    "The mapping does not say where special 1 of this entry belongs",
    "S3E13 Part 1",
  ]);
  // For an entry that is itself specials, a file's number is one of its own episodes as before.
  assert.deepEqual(short(await special(4, [2])), ["S0E5 Part 2"]);
  // In TMDB numbering only the TMDB rule for specials applies.
  assert.deepEqual(short(await special(2, [2], [3])), ["S0E3 ", "The mapping does not say where special 3 of this entry belongs"]);

  // A long runner the list gives no single season for is still split by its rules.
  list.push({ kitsu_id: 3, anidb_id: 900, tvdb_id: 5000, themoviedb_id: { tv: 6000 } } as (typeof list)[number]);
  const long = new Providers({
    fetcher: async (url) =>
      Response.json({ data: [14, 15].map((number) => ({ attributes: { number, canonicalTitle: `Part ${number}` } })) }),
    animeMap: new AnimeMap({
      fetcher: (async (address: string) =>
        address.endsWith(".xml") ? new Response(XML) : Response.json(list)) as typeof fetch,
    }),
  });
  const [run] = await long.resolveMany(entry(3), [{ season: null, episode: 14 }]);
  assert.ok("media" in run!);
  assert.deepEqual([run.media.season, run.media.episode, run.media.tmdbId], [2, 1, 6000]);
  // TMDB numbering is in use for this one, so only the TMDB rule applies.
  assert.deepEqual(short(await ask(2, [9], [14], [30])), ["S1E9 Part 9", "S2E1 Part 14", "S1E30 Part 30"]);
});

test("the list is kept for a week, reused if a refresh fails, and never fatal", async () => {
  let downloads = 0, now = 1_000_000, saved: { savedAt: number; text: string } | null = null, online = true;
  let exceptionsOnline = true;
  const make = () =>
    new AnimeMap({
      now: () => now,
      fetcher: (async (address: string) => {
        if (!online) throw new Error("offline");
        if (address.endsWith(".xml")) {
          if (!exceptionsOnline) throw new Error("no exceptions today");
          return new Response(XML);
        }
        downloads++;
        return Response.json(LIST);
      }) as typeof fetch,
      cache: {
        read: async () => saved,
        write: async (text) => void (saved = { savedAt: now, text }),
      },
    });
  const map = make();
  assert.equal((await map.lookup(46474))!.tmdbId, 209867);
  assert.equal(await map.lookup(123), null);
  assert.equal(downloads, 1);
  // Only the reduced index is stored.
  assert.ok(saved!.text.length < JSON.stringify(LIST).length && !saved!.text.includes("kitsu_id"));
  // A new launch within the week reads the saved copy.
  assert.equal((await make().lookup(41982))!.tmdbOffset, 12);
  assert.equal(downloads, 1);
  // After a week it refreshes; offline, the old copy still serves.
  now += 8 * 24 * 60 * 60 * 1000;
  online = false;
  assert.equal((await make().lookup(46474))!.tvdbId, 424536);
  assert.equal(downloads, 1);
  // With nothing saved and no network, lookups find nothing and try again later.
  saved = null;
  const cold = make();
  assert.equal(await cold.lookup(46474), null);
  online = true;
  assert.equal((await cold.lookup(46474))!.tmdbId, 209867);
  // If only the exceptions fail, the list still works but is not saved, so they are retried.
  saved = null;
  exceptionsOnline = false;
  assert.equal((await make().lookup(46474))!.tmdbId, 209867);
  assert.equal(saved, null);
  exceptionsOnline = true;
  // Turned off, nothing is downloaded at all.
  const off = make();
  off.enabled = false;
  const before = downloads;
  assert.equal(await off.lookup(46474), null);
  assert.equal(downloads, before);
});
