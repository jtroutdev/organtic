import test from "node:test";
import assert from "node:assert/strict";
import { Providers } from "../core/providers.ts";
import type { SearchInput } from "../core/providers.ts";
import type { Candidate, ResolveResult } from "../core/types.ts";
test("TVmaze search normalizes data, caches responses, and resolves an episode", async () => {
  const calls: string[] = [];
  const providers = new Providers({
    fetcher: async (url) => {
      calls.push(String(url));
      return Response.json(
        String(url).includes("episodebynumber")
          ? {
              id: 20,
              name: "Pilot",
              summary: "<p>A &amp; B</p>",
              airdate: "2022-01-01",
            }
          : [
              {
                show: {
                  id: 2,
                  name: "Show",
                  premiered: "2022-01-01",
                  summary: "<b>Plot</b>",
                  url: "https://www.tvmaze.com/shows/2",
                  externals: { tvrage: null, thetvdb: 371980, imdb: "tt11280740" },
                },
              },
            ],
      );
    },
  });
  const input: SearchInput = { provider: "tvmaze", kind: "tv", query: "Show" };
  const [candidate] = await providers.search(input);
  await providers.search(input);
  assert.equal(calls.length, 1);
  assert.equal(candidate.overview, "Plot");
  assert.deepEqual([candidate.tvdbId, candidate.imdbId], [371980, "tt11280740"]);
  const resolved = await providers.resolve(candidate, {
    season: 0,
    episode: 1,
  });
  assert.equal(resolved.episodeId, 20);
  assert.equal(resolved.tvdbId, 371980);
  assert.equal(resolved.overview, "A & B");
  assert.match(calls[1], /season=0/);
});
test("missing token and transport errors are not empty results", async () => {
  const p = new Providers({
    fetcher: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(
    p.search({ provider: "tmdb", kind: "movie", query: "Arrival" }),
    /token/,
  );
  await assert.rejects(
    p.search({ provider: "tvmaze", kind: "tv", query: "Show" }),
    /connection/,
  );
});
test("searching every source keeps what answered and names what did not", async () => {
  const asked: string[] = [];
  const p = new Providers({
    fetcher: async (url) => {
      asked.push(`${url.hostname}${url.pathname}${url.searchParams.has("year") ? "?year" : ""}`);
      if (url.hostname === "api.tvmaze.com") throw new Error("offline");
      if (url.hostname === "kitsu.io")
        return Response.json({ data: [{ id: "3", attributes: { canonicalTitle: "Film", subtype: "movie" } }] });
      return Response.json({
        results: url.searchParams.has("year") ? [] : [{ id: 1, title: "Film", release_date: "1999-01-01" }],
      });
    },
  });
  // Kitsu is only asked about anime.
  assert.deepEqual(await p.searchAll({ kind: "movie", query: "Film" }), { found: [], failed: [] });
  assert.equal(asked.length, 0);
  // Without a token TMDB is left out; TVmaze has no films.
  const films = await p.searchAll({ kind: "movie", query: "Film", year: 1998, anime: true });
  assert.deepEqual([films.found.map((item) => item.provider), films.failed], [["kitsu"], []]);
  p.setToken("test");
  asked.length = 0;
  const again = await p.searchAll({ kind: "movie", query: "Film", year: 1998, anime: true });
  assert.deepEqual(again.found.map((item) => [item.provider, item.id]), [["tmdb", 1], ["kitsu", 3]]);
  // TMDB found nothing for that year, so it was asked again without it.
  assert.deepEqual(asked.filter((item) => item.includes("themoviedb")), [
    "api.themoviedb.org/3/search/movie?year",
    "api.themoviedb.org/3/search/movie",
  ]);
  const shows = await p.searchAll({ kind: "tv", query: "Film" });
  assert.deepEqual(shows.failed.map((item) => [item.provider, /connection/.test(item.message)]), [["tvmaze", true]]);
});
test("retries rate limiting and handles unauthorized and malformed data", async () => {
  let calls = 0;
  const p = new Providers({
    sleep: async () => {},
    fetcher: async () =>
      ++calls === 1 ? new Response("", { status: 429 }) : Response.json([]),
  });
  assert.deepEqual(
    await p.search({ provider: "tvmaze", kind: "tv", query: "Show" }),
    [],
  );
  assert.equal(calls, 2);
  const bad = new Providers({
    fetcher: async () => new Response("", { status: 401 }),
  });
  bad.setToken("test");
  await assert.rejects(
    bad.search({ provider: "tmdb", kind: "movie", query: "Title" }),
    /rejected/,
  );
  const malformed = new Providers({ fetcher: async () => Response.json(null) });
  await assert.rejects(
    malformed.search({ provider: "tvmaze", kind: "tv", query: "Show" }),
    /invalid data/,
  );
});

const titles = (results: ResolveResult[]) =>
  results.map((result) =>
    "media" in result
      ? `S${result.media.season}E${result.media.episode}${result.media.episodeEnd ? `-${result.media.episodeEnd}` : ""} ${result.media.episodeTitle}`
      : result.error,
  );

test("resolves a batch with one request per season, including absolute and multi-episode files", async () => {
  const calls: string[] = [];
  const providers = new Providers({
    fetcher: async (url) => {
      calls.push(url.pathname);
      if (url.pathname === "/3/tv/7")
        return Response.json({
          seasons: [
            { season_number: 0, episode_count: 3 },
            { season_number: 1, episode_count: 2 },
            { season_number: 2, episode_count: 2 },
          ],
        });
      const season = Number(url.pathname.split("/").at(-1));
      if (season > 2) return new Response("", { status: 404 });
      return Response.json({
        poster_path: `/season${season}.jpg`,
        episodes: [1, 2].map((number) => ({
          id: season * 10 + number,
          episode_number: number,
          name: `S${season} Part ${number}`,
          air_date: "2024-01-01",
        })),
      });
    },
  });
  providers.setToken("test");
  const show: Candidate = { provider: "tmdb", kind: "tv", id: 7, title: "Show", year: 2024, overview: "" };
  const results = await providers.resolveMany(show, [
    { season: 1, episode: 1 },
    { season: 1, episode: 1, episodeEnd: 2 },
    { season: null, episode: 3 },
    { season: null, episode: 4 },
    { season: null, episode: 5 },
    { season: 1, episode: 9 },
    { season: 5, episode: 1 },
  ]);
  assert.deepEqual(titles(results), [
    "S1E1 S1 Part 1",
    "S1E1-2 S1 Part 1 & S1 Part 2",
    "S2E1 S2 Part 1",
    "S2E2 S2 Part 2",
    "Episode 5 is beyond the 4 episodes listed for this show.",
    "Season 1 episode 9 was not found for this show.",
    "This episode was not found. Check its season and episode numbers.",
  ]);
  assert.deepEqual(
    results.flatMap((result) => ("media" in result ? [result.media.seasonPosterUrl] : [])).slice(0, 3),
    [1, 1, 2].map((season) => `https://image.tmdb.org/t/p/original/season${season}.jpg`),
  );
  // The show once for season sizes, then each season once.
  assert.deepEqual(calls, ["/3/tv/7", "/3/tv/7/season/1", "/3/tv/7/season/2", "/3/tv/7/season/5"]);
});

test("finds episodes by name, and reads 812 as season 8 episode 12 where that fits", async () => {
  const names: Record<number, string[]> = {
    1: ["Pilot", "Homer's Odyssey", "Who Shot Mr. Burns? (1)"],
    2: ["Who Shot Mr. Burns? (2)", "Lisa the Vegetarian", "Homer's Enemy"],
  };
  const providers = new Providers({
    fetcher: async (url) => {
      if (url.pathname === "/3/tv/7")
        return Response.json({
          seasons: [1, 2].map((season) => ({ season_number: season, episode_count: 3 })),
        });
      const season = Number(url.pathname.split("/").at(-1));
      if (!names[season]) return new Response("", { status: 404 });
      return Response.json({
        episodes: names[season].map((name, index) => ({
          id: season * 10 + index,
          episode_number: index + 1,
          name,
        })),
      });
    },
  });
  providers.setToken("test");
  const show: Candidate = { provider: "tmdb", kind: "tv", id: 7, title: "Show", year: 2024, overview: "" };
  const results = await providers.resolveMany(show, [
    { season: null, episode: 1, title: "Lisa the Vegeterian", byTitle: true },
    { season: null, episode: 1, title: "Bart Gets an F", byTitle: true },
    { season: null, episode: 1, title: "Who Shot Mr Burns", byTitle: true },
    { season: null, episode: 1, title: null, byTitle: true },
    // 203 is past the six episodes, so it is season 2, episode 3.
    { season: null, episode: 203 },
    // Numbers that find nothing give way to the name; numbers that work are trusted.
    { season: 2, episode: 9, title: "Homers Odyssey" },
    { season: 1, episode: 1, title: "Homer's Enemy" },
    { season: 2, episode: 9, title: "Nothing Like It" },
  ]);
  assert.deepEqual(titles(results), [
    "S2E2 Lisa the Vegetarian",
    "No episode of this show is named like “Bart Gets an F”.",
    "“Who Shot Mr Burns” fits more than one episode (S1E3 “Who Shot Mr. Burns? (1)”, S2E1 “Who Shot Mr. Burns? (2)”). Set the season and episode for this file.",
    "No episode number was found in this filename.",
    "S2E3 Homer's Enemy",
    "S1E2 Homer's Odyssey",
    "S1E1 Pilot",
    "Season 2 episode 9 was not found for this show.",
  ]);
});

test("resolves a TVmaze batch from a single episode listing", async () => {
  let calls = 0;
  const providers = new Providers({
    fetcher: async () => {
      calls++;
      return Response.json([
        { id: 1, season: 1, number: 1, name: "One", summary: "<p>Plot</p>", airdate: "2022-02-18" },
        { id: 2, season: 1, number: 2, name: "Two" },
        { id: 3, season: 1, number: null, name: "Special", type: "significant_special" },
        { id: 4, season: 2, number: 1, name: "Three" },
      ]);
    },
  });
  const show: Candidate = { provider: "tvmaze", kind: "tv", id: 9, title: "Show", year: 2022, overview: "" };
  const results = await providers.resolveMany(show, [
    { season: 1, episode: 2 },
    { season: null, episode: 3 },
  ]);
  assert.deepEqual(titles(results), ["S1E2 Two", "S2E1 Three"]);
  // One request each for the show's images, its season posters and all its episodes.
  assert.equal(calls, 3);
});

test("search results carry artwork addresses from the providers' image hosts", async () => {
  const tmdb = new Providers({
    fetcher: async () =>
      Response.json({
        results: [
          { id: 1, title: "Arrival", poster_path: "/abc123.jpg", backdrop_path: "/def456.jpg" },
          { id: 2, title: "Odd", poster_path: "https://elsewhere.example/x.jpg", backdrop_path: null },
        ],
      }),
  });
  tmdb.setToken("test");
  const [arrival, odd] = await tmdb.search({ provider: "tmdb", kind: "movie", query: "Arrival" });
  assert.equal(arrival!.posterUrl, "https://image.tmdb.org/t/p/original/abc123.jpg");
  assert.equal(arrival!.backdropUrl, "https://image.tmdb.org/t/p/original/def456.jpg");
  assert.deepEqual([odd!.posterUrl, odd!.backdropUrl], [undefined, undefined]);

  // TVmaze: the poster comes with the search result, the backdrop from the show's image list.
  const tvmaze = new Providers({
    fetcher: async (url) =>
      url.pathname.endsWith("/images")
        ? Response.json([
            { type: "poster", main: true, resolutions: { original: { url: "https://static.tvmaze.com/p.jpg" } } },
            { type: "background", main: false, resolutions: { original: { url: "https://static.tvmaze.com/b1.jpg" } } },
            { type: "background", main: true, resolutions: { original: { url: "https://static.tvmaze.com/b2.jpg" } } },
          ])
        : url.pathname.endsWith("/seasons")
          ? Response.json([
              { number: 1, image: { original: "https://static.tvmaze.com/s1.jpg" } },
              { number: 2, image: null },
            ])
        : url.pathname.endsWith("/episodes")
          ? Response.json([{ id: 1, season: 1, number: 1, name: "One" }])
          : Response.json([{ show: { id: 9, name: "Show", image: { original: "https://static.tvmaze.com/poster.jpg" } } }]),
  });
  const [show] = await tvmaze.search({ provider: "tvmaze", kind: "tv", query: "Show" });
  assert.equal(show!.posterUrl, "https://static.tvmaze.com/poster.jpg");
  const [resolved] = await tvmaze.resolveMany(show!, [{ season: 1, episode: 1 }]);
  assert.ok("media" in resolved!);
  assert.equal(resolved.media.backdropUrl, "https://static.tvmaze.com/b2.jpg");
  assert.equal(resolved.media.seasonPosterUrl, "https://static.tvmaze.com/s1.jpg");
});

test("alternate orderings map file numbers to aired episodes or keep them", async () => {
  // A disc set that opens with the aired pilot at position 3 and splits a two-parter across seasons.
  const tmdb = new Providers({
    fetcher: async (url) =>
      url.pathname.endsWith("/episode_groups")
        ? Response.json({
            results: [
              { id: "5acf93e60e0a26346d0000ce", name: "DVD Order", type: 3 },
              { id: "not-an-id", name: "Bad", type: 9 },
            ],
          })
        : Response.json({
            groups: [
              {
                order: 1,
                episodes: [
                  { id: 13, name: "Third", season_number: 1, episode_number: 3, order: 1 },
                  { id: 11, name: "First", season_number: 1, episode_number: 1, order: 0 },
                  { id: 12, name: "Second", season_number: 1, episode_number: 2, order: 2 },
                  { id: 21, name: "Finale", season_number: 2, episode_number: 1, order: 3 },
                ],
              },
              { order: 0, episodes: [{ id: 1, name: "Extra", season_number: 0, episode_number: 5, order: 0 }] },
            ],
          }),
  });
  tmdb.setToken("test");
  const show: Candidate = { provider: "tmdb", kind: "tv", id: 7, title: "Show", year: 2002, overview: "" };
  assert.deepEqual(await tmdb.orderings(show), [{ id: "5acf93e60e0a26346d0000ce", name: "DVD Order · DVD" }]);
  assert.deepEqual(await tmdb.orderings({ ...show, kind: "movie" }), []);

  const requests = [
    { season: 1, episode: 1 },
    { season: 1, episode: 2 },
    { season: 1, episode: 2, episodeEnd: 3 },
    { season: 1, episode: 1, episodeEnd: 2 },
    { season: 1, episode: 3, episodeEnd: 4 },
    { season: null, episode: 4 },
    { season: 0, episode: 1 },
    { season: 1, episode: 9 },
  ];
  const id = "5acf93e60e0a26346d0000ce";
  assert.deepEqual(titles(await tmdb.resolveMany(show, requests, "en-US", { id, keepNumbers: false })), [
    "S1E1 First",
    "S1E3 Third",
    // Positions 2 and 3 are aired episodes 3 and 2: not a run, so no single aired name fits.
    "These episodes are not next to each other in aired order, so one file cannot be named for them. Keep the files' own numbers instead.",
    "These episodes are not next to each other in aired order, so one file cannot be named for them. Keep the files' own numbers instead.",
    "These episodes are not next to each other in aired order, so one file cannot be named for them. Keep the files' own numbers instead.",
    "S2E1 Finale",
    "S0E5 Extra",
    "Season 1 episode 9 was not found in this order.",
  ]);
  assert.deepEqual(titles(await tmdb.resolveMany(show, requests, "en-US", { id, keepNumbers: true })).slice(0, 7), [
    "S1E1 First",
    "S1E2 Third",
    "S1E2-3 Third & Second",
    "S1E1-2 First & Third",
    "S1E3-4 Second & Finale",
    "S1E4 Finale",
    "S0E1 Extra",
  ]);
  await assert.doesNotReject(tmdb.resolveMany(show, requests, "en-US", { id: "../x", keepNumbers: false }));
  assert.match(titles(await tmdb.resolveMany(show, requests, "en-US", { id: "../x", keepNumbers: false }))[0]!, /Unknown episode order/);

  // TVmaze: alternate lists, each position embedding the aired episode it holds.
  const tvmaze = new Providers({
    fetcher: async (url) =>
      url.pathname.endsWith("/alternatelists")
        ? Response.json([{ id: 1, dvd_release: true, network: null }, { id: 2, country_premiere: true, network: { name: "BBC" } }])
        : url.pathname.includes("/alternateepisodes")
          ? Response.json([
              { season: 1, number: 1, _embedded: { episodes: [{ id: 13005, name: "Serenity", season: 1, number: 11 }] } },
              { season: 1, number: 2, _embedded: { episodes: [{ id: 12995, name: "The Train Job", season: 1, number: 1 }] } },
            ])
          : Response.json([]),
  });
  const firefly: Candidate = { provider: "tvmaze", kind: "tv", id: 180, title: "Firefly", year: 2002, overview: "", backdropUrl: "" };
  assert.deepEqual(await tvmaze.orderings(firefly), [
    { id: "1", name: "DVD order" },
    { id: "2", name: "Country premiere order (BBC)" },
  ]);
  assert.deepEqual(
    titles(await tvmaze.resolveMany(firefly, [{ season: 1, episode: 1 }, { season: 1, episode: 2 }], "en-US", { id: "1", keepNumbers: false })),
    ["S1E11 Serenity", "S1E1 The Train Job"],
  );
});

test("finds an episode by the day it aired", async () => {
  const calls: string[] = [];
  const tmdb = new Providers({
    fetcher: async (url) => {
      calls.push(url.pathname.replace("/3/", ""));
      if (url.pathname === "/3/tv/7")
        return Response.json({
          seasons: [
            { season_number: 0, air_date: "2020-01-01" },
            { season_number: 28, air_date: "2022-09-13" },
            { season_number: 29, air_date: "2023-10-16" },
            { season_number: 30, air_date: "2024-09-10" },
          ],
        });
      const season = Number(url.pathname.split("/").at(-1));
      const days: Record<number, [number, string][]> = {
        28: [[120, "2023-10-17"]],
        29: [[1, "2023-10-16"], [64, "2024-03-14"], [65, "2024-03-14"], [66, "2024-03-15"]],
      };
      return Response.json({
        episodes: (days[season] ?? []).map(([number, air_date]) => ({ id: season * 1000 + number, episode_number: number, name: `Show ${number}`, air_date })),
      });
    },
  });
  tmdb.setToken("test");
  const show: Candidate = { provider: "tmdb", kind: "tv", id: 7, title: "Daily", year: 1996, overview: "" };
  const by = (airDate: string) => ({ season: null, episode: 1, airDate });
  const results = await tmdb.resolveMany(show, [
    by("2024-03-15"),
    by("2023-10-17"),
    by("2024-03-14"),
    by("2024-03-16"),
    by("1990-01-01"),
  ]);
  assert.deepEqual(titles(results), [
    "S29E66 Show 66",
    // Not in the latest season to have started, so the one before is tried.
    "S28E120 Show 120",
    "2 episodes aired on 2024-03-14 (S29E64, S29E65). Set the season and episode for this file.",
    "No episode of this show is listed as airing on 2024-03-16.",
    "No episode of this show is listed as airing on 1990-01-01.",
  ]);
  assert.ok("media" in results[0]! && results[0].media.aired === "2024-03-15");
  // Seasons that had not started by the date are never fetched.
  assert.ok(!calls.includes("tv/7/season/30"));

  const tvmaze = new Providers({
    fetcher: async (url) =>
      url.pathname.endsWith("/episodes")
        ? Response.json([
            { id: 1, season: 2024, number: 40, name: "Thursday", airdate: "2024-03-14" },
            { id: 2, season: 2024, number: 41, name: "Friday", airdate: "2024-03-15" },
          ])
        : Response.json([]),
  });
  const daily: Candidate = { provider: "tvmaze", kind: "tv", id: 9, title: "Daily", year: 1996, overview: "", backdropUrl: "" };
  assert.deepEqual(titles(await tvmaze.resolveMany(daily, [by("2024-03-15")])), ["S2024E41 Friday"]);
  // Dates and alternate orderings do not mix.
  assert.match(titles(await tvmaze.resolveMany(daily, [by("2024-03-15")], "en-US", { id: "1", keepNumbers: false }))[0]!, /only be looked up in aired order/);
});

// Shaped like Kitsu's JSON:API responses.
const kitsu = (calls: string[] = []) =>
  new Providers({
    fetcher: async (url, init) => {
      calls.push(`${url.pathname.replace("/api/edge/", "")}?${url.searchParams}`);
      assert.equal(new Headers(init.headers).get("accept"), "application/vnd.api+json");
      if (url.pathname.endsWith("/episodes")) {
        const offset = Number(url.searchParams.get("page[offset]"));
        return Response.json({
          data: Array.from({ length: offset === 0 ? 20 : 8 }, (_, index) => ({
            attributes: {
              number: offset + index + 1,
              canonicalTitle: `Episode ${offset + index + 1}`,
              titles: { en_us: offset + index + 1 === 22 ? "Future Enemies" : null, en_jp: "Romaji" },
              airdate: "2024-02-09",
            },
          })),
        });
      }
      const text = url.searchParams.get("filter[text]") ?? "";
      return Response.json({
        data: [
          {
            id: "46474",
            attributes: {
              canonicalTitle: "Sousou no Frieren",
              titles: { en: "Frieren: Beyond Journey’s End", en_jp: "Sousou no Frieren", ja_jp: "葬送のフリーレン" },
              abbreviatedTitles: ["Frieren"],
              slug: "sousou-no-frieren",
              synopsis: "An elf mage.",
              startDate: "2023-09-29",
              subtype: "TV",
              posterImage: { original: "https://media.kitsu.app/anime/46474/poster.jpg" },
              coverImage: { original: "http://insecure.example/cover.jpg" },
            },
            relationships: { mappings: { data: [{ id: "1" }, { id: "2" }] } },
          },
          {
            id: "8671",
            attributes: { canonicalTitle: "Attack on Titan Season 2", titles: { en_jp: "Shingeki no Kyojin Season 2" }, startDate: "2017-04-01", subtype: "TV" },
            relationships: { mappings: { data: [{ id: "3" }] } },
          },
          { id: "11614", attributes: { canonicalTitle: "Kimi no Na wa.", titles: { en: "Your Name." }, startDate: "2016-08-26", subtype: "movie" } },
        ].filter((item) => !text.includes("nothing")),
        included: [
          { id: "1", attributes: { externalSite: "anilist/anime", externalId: "154587" } },
          { id: "2", attributes: { externalSite: "myanimelist/anime", externalId: "52991" } },
          { id: "3", attributes: { externalSite: "thetvdb", externalId: "267440/2" } },
        ],
      });
    },
  });

test("Kitsu supplies anime entries, their episodes and what else they are called", async () => {
  const calls: string[] = [];
  const providers = kitsu(calls);
  const shows = await providers.search({ provider: "kitsu", kind: "tv", query: "sousou no frieren" });
  assert.deepEqual(shows.map((show) => [show.title, show.year, show.tvdbId, show.tvdbSeason]), [
    ["Frieren: Beyond Journey’s End", 2023, undefined, undefined],
    ["Attack on Titan Season 2", 2017, 267440, 2],
  ]);
  const [frieren, titan] = shows;
  assert.deepEqual(
    [frieren!.provider, frieren!.id, frieren!.posterUrl, frieren!.backdropUrl, frieren!.sourceUrl],
    ["kitsu", 46474, "https://media.kitsu.app/anime/46474/poster.jpg", undefined, "https://kitsu.app/anime/sousou-no-frieren"],
  );
  const japanese = await providers.search({ provider: "kitsu", kind: "tv", query: "sousou no frieren", language: "ja-JP" });
  assert.equal(japanese[0]!.title, "葬送のフリーレン");
  const films = await providers.search({ provider: "kitsu", kind: "movie", query: "your name" });
  assert.deepEqual(films.map((film) => film.title), ["Your Name."]);
  assert.match(calls.at(-1)!, /subtype%5D=movie/);

  // An entry counts its own episodes from 1: an absolute number and a claimed season both land there.
  calls.length = 0;
  const resolved = await providers.resolveMany(frieren!, [
    { season: null, episode: 22 },
    { season: 2, episode: 3 },
    { season: null, episode: 20, episodeEnd: 21 },
    { season: null, episode: 40 },
    { season: null, episode: 1, airDate: "2024-02-09" },
  ]);
  assert.deepEqual(titles(resolved), [
    "S1E22 Future Enemies",
    "S2E3 Episode 3",
    "S1E20-21 Episode 20 & Episode 21",
    "Episode 40 was not found for this entry.",
    "Kitsu cannot look an episode up by date. Set the season and episode for this file.",
  ]);
  // Twenty to a page, fetched only where an episode is needed.
  assert.equal(calls.filter((call) => call.includes("/episodes")).length, 2);
  // Where Kitsu maps an entry to a TVDB season, that season is used whatever the file says.
  assert.deepEqual(titles(await providers.resolveMany(titan!, [{ season: 1, episode: 5 }])), ["S2E5 Episode 5"]);
  assert.deepEqual(await providers.orderings(frieren!), []);

  assert.deepEqual(await providers.alternativeTitles("tv", "Sousou no Frieren"), [
    "Frieren: Beyond Journey’s End",
    "Frieren",
    "葬送のフリーレン",
  ]);
  // Only an exact title counts; a near miss must not rename someone's files after another show.
  assert.deepEqual(await providers.alternativeTitles("tv", "Sousou no"), []);
  assert.deepEqual(await providers.alternativeTitles("tv", "nothing"), []);
});
