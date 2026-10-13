# Third-party notices

Original application code is covered by [LICENSE](LICENSE). Third-party libraries, provider data, images, and trademarks retain their own terms.

## Contents

- [TMDB](#tmdb)
- [TVmaze](#tvmaze)
- [TheTVDB](#thetvdb)
- [Kitsu](#kitsu)
- [Anime mapping lists](#anime-mapping-lists)
- [Fonts](#fonts)
- [Dependencies](#dependencies)
- [Prior art](#prior-art)

## TMDB

This product uses the TMDB API but is not endorsed or certified by TMDB.

The official TMDB logo in `public/tmdb-logo.svg` was downloaded without alteration from the approved [logos and attribution page](https://www.themoviedb.org/about/logos-attribution), asset `/assets/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg`. It is not licensed under this project's MIT license. API data and images are subject to [TMDB's API terms of use](https://www.themoviedb.org/api-terms-of-use) (last updated 20 October 2023) and its [FAQ](https://developer.themoviedb.org/docs/faq). No shared API token is included; each user's token is their own licence from TMDB.

As read on 12 October 2026:

- Use is free for non-commercial purposes with attribution. A project whose primary purpose is to make money for its owner needs a commercial licence from TMDB, and charging for an app that uses TMDB is given as an example. This bears on any paid or donation-supported distribution.
- The notice above is the FAQ's wording and is shown with the logo under Settings, Sources, which the FAQ accepts as an "About" or "Credits" section. The terms of use word it slightly differently ("uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB").
- The logo must stay unmodified and less prominent than the app's own mark. It is shown 12 pixels high.
- Information may not be cached for longer than six months. The app keeps lookups in memory for an hour. NFO files and artwork that a user saves into their own library stay there; whether that counts as caching is the user's question under their own licence, not something this project redistributes.
- TMDB content may not be used to train machine-learning systems.

Posters and backdrops downloaded at the user's request come from `image.tmdb.org` and are subject to the same terms; they are saved to the user's own library and are not redistributed by this project.

## TVmaze

TV data is provided by [TVmaze](https://www.tvmaze.com). The public API's data is licensed under [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/); see [API licensing](https://www.tvmaze.com/api#licensing). These requirements apply to downloaded/exported data independently of the code license. Generated NFO files identify TVmaze and its data license. Images downloaded from `static.tvmaze.com` at the user's request are covered by the same license.

As read on 12 October 2026, the API page asks for credit by linking back to TVmaze, which Settings and each match's source page do, allows at least 20 calls every 10 seconds per address, and asks clients to treat HTTP 429 as "wait and retry" and to send a descriptive User-Agent. The app sends `Organtic/<version>`, runs three lookups at a time and retries after a 429. No change was needed.

## TheTVDB

When the user supplies their own API key, episode titles for some anime specials come from [TheTVDB](https://thetvdb.com). Metadata provided by TheTVDB. Please consider adding missing information or subscribing. Use of the API is subject to TheTVDB's terms; no key is included.

As read on 12 October 2026, **this is not settled**. TheTVDB's [API information](https://thetvdb.com/api-information) prices a licence by the licensee's revenue (free under $50,000 a year, with attribution) and offers discounts to open-source projects. Its [v4 API notes](https://github.com/thetvdb/v4-api) say an app whose users reach the API directly should either agree a contract with TheTVDB in advance or use a subscriber-supported key, where each user holds a paid subscription and enters a PIN. Organtic instead asks each user for a key of their own. Nothing found says that is forbidden, and nothing says it is the intended use. Ask TheTVDB which arrangement they want before distributing a build that advertises this feature.

Attribution must reach users who see the metadata and link directly to thetvdb.com. Settings shows the sentence above with that link.

## Kitsu

Anime titles, episode data, and images are provided by [Kitsu](https://kitsu.app) through its public API. This project is not affiliated with or endorsed by Kitsu. Its data and images remain subject to Kitsu's terms.

As read on 12 October 2026, **this is not settled**. Kitsu's [terms of use](https://kitsu.app/terms) are version 1.0 of 1 December 2016 and do not mention the API. Section 1.1 allows access by means other than the site only as "specifically authorized by Kitsu", and section 1.3 forbids copying or using Kitsu content apart from the service, making derivative works of it, and commercial use. Kitsu publishes and documents the API, which suggests third-party apps are expected, but no written permission for them was found, for the data or for the images. Ask Kitsu before distributing a build. Settings names Kitsu as the source and links to it.

## Anime mapping lists

Season and ID mappings for Kitsu entries come from [Fribb/anime-lists](https://github.com/Fribb/anime-lists). Per-episode exceptions are read from `anime-list-master.xml` in [Anime-Lists/anime-lists](https://github.com/Anime-Lists/anime-lists). Neither list is bundled or redistributed with this project: the app downloads them at the user's request and keeps only a reduced index locally.

Terms, as found on 7 October 2026 and checked again on 12 October 2026:

- **Anime-Lists/anime-lists** states no license. A request to add one ([issue 613](https://github.com/Anime-Lists/anime-lists/issues/613), opened July 2026) is open. Two other people have since asked the same, the latest on 22 September 2026; the maintainers have not replied.
- **Fribb/anime-lists** states no license of its own. Its README says it is generated from Anime-Lists/anime-lists and from [anime-offline-database](https://github.com/cedya77/anime-offline-database), which is published under the Open Database License 1.0 (attribution, and share-alike for a redistributed database). Data derived from it carries those terms whatever the Fribb repository itself states. That repository continues the original by [manami-project](https://github.com/manami-project/anime-offline-database), archived in July 2026, and asks that attribution name both. This notice is that attribution: the mappings include data from anime-offline-database by cedya77 and manami-project, under the ODbL 1.0.

This has not been confirmed with either maintainer, and no one from this project has contacted them. For that reason the setting that downloads the lists, "Place Kitsu matches in their TMDB or TVDB season", is off by default. Do not bundle either list.

## Fonts

Red Hat Text, Red Hat Mono, and Readex Pro are bundled through the `@fontsource` packages under the [SIL Open Font License 1.1](https://openfontlicense.org). Each package includes its license text.

## Dependencies

Electron, Vue, Vite, and packaging dependencies include their own license files. The lockfile pins the dependency tree. Release packaging must retain required notices for the runtime and bundled dependencies.

As checked in the Linux package on 12 October 2026: it carries `LICENSE.electron.txt` and `LICENSES.chromium.html` beside the app, and inside the app the licence file of every runtime package (Vue and its parts, MIT; the three font packages, OFL 1.1), this project's `LICENSE`, and this file. The Windows and macOS packages are built from the same configuration but were not opened.

## Prior art

FileBot and tinyMediaManager inspired the requested problem space. No code or assets from either project were incorporated. No affiliation or endorsement is claimed.
