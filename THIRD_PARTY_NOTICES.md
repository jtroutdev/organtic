# Third-party notices

Original application code is covered by [LICENSE](LICENSE). Third-party libraries, provider data, images, and trademarks retain their own terms.

## TMDB

This product uses the TMDB API but is not endorsed or certified by TMDB.

The official TMDB logo in `public/tmdb-logo.svg` was downloaded without alteration from the approved [logos and attribution page](https://www.themoviedb.org/about/logos-attribution), asset `/assets/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg`. It is not licensed under this project's MIT license. API data and images are subject to [TMDB's terms](https://developer.themoviedb.org/docs/faq), including attribution and commercial-use conditions. No shared API token is included.

Posters and backdrops downloaded at the user's request come from `image.tmdb.org` and are subject to the same terms; they are saved to the user's own library and are not redistributed by this project.

## TVmaze

TV data is provided by [TVmaze](https://www.tvmaze.com). The public API's data is licensed under [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/); see [API licensing](https://www.tvmaze.com/api#licensing). These requirements apply to downloaded/exported data independently of the code license. Generated NFO files identify TVmaze and its data license. Images downloaded from `static.tvmaze.com` at the user's request are covered by the same license.

## TheTVDB

When the user supplies their own API key, episode titles for some anime specials come from [TheTVDB](https://thetvdb.com). Metadata provided by TheTVDB. Please consider adding missing information or subscribing. Use of the API is subject to TheTVDB's terms, which differ for user-subscription keys and for keys licensed to a project; no key is included.

## Kitsu

Anime titles, episode data, and images are provided by [Kitsu](https://kitsu.app) through its public API. This project is not affiliated with or endorsed by Kitsu. Its data and images remain subject to Kitsu's terms; review them before distributing a build.

## Anime mapping lists

Season and ID mappings for Kitsu entries come from [Fribb/anime-lists](https://github.com/Fribb/anime-lists). Per-episode exceptions are read from `anime-list-master.xml` in [Anime-Lists/anime-lists](https://github.com/Anime-Lists/anime-lists). Neither list is bundled or redistributed with this project: the app downloads them at the user's request and keeps only a reduced index locally.

Terms, as found on 7 October 2026:

- **Anime-Lists/anime-lists** states no license. A request to add one ([issue 613](https://github.com/Anime-Lists/anime-lists/issues/613), opened July 2026) is open and has no reply from the maintainers.
- **Fribb/anime-lists** states no license of its own. Its README says it is generated from Anime-Lists/anime-lists and from [anime-offline-database](https://github.com/cedya77/anime-offline-database), which is published under the Open Database License 1.0 (attribution, and share-alike for a redistributed database). Data derived from it carries those terms whatever the Fribb repository itself states.

This has not been confirmed with either maintainer, and no one from this project has contacted them. For that reason the setting that downloads the lists, "Place Kitsu matches in their TMDB or TVDB season", is off by default. Do not bundle either list.

## Fonts

Red Hat Text, Red Hat Mono, and Readex Pro are bundled through the `@fontsource` packages under the [SIL Open Font License 1.1](https://openfontlicense.org). Each package includes its license text.

## Dependencies

Electron, Vue, Vite, and packaging dependencies include their own license files. The lockfile pins the dependency tree. Release packaging must retain required notices for the runtime and bundled dependencies.

## Prior art

FileBot and tinyMediaManager inspired the requested problem space. No code or assets from either project were incorporated. No affiliation or endorsement is claimed.
