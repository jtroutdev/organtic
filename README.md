# Organtic

An independent, local-first desktop application for matching and renaming movie and TV files. Built with Electron and Vue, with a reusable JavaScript core. Original code is MIT licensed. This is an early development version, not a FileBot fork.

## Run it

Install Node.js 24 or later, then run these commands in this folder (works in Fish, Bash, and PowerShell):

```sh
npm ci
npm start
```

`npm start` builds and launches the desktop app. Linux requires a desktop session and Electron's system libraries. `npm run dev` serves a browser preview at [http://127.0.0.1:47831](http://127.0.0.1:47831) that runs the real queue logic over clearly labeled example files and a canned catalogue; it cannot access or rename your files or contact a metadata source. The server stops with an error if port 47831 is occupied instead of silently choosing another port. To override it, run `npm run dev -- --port 47832`.

```sh
npm test          # Core tests using temporary files; no personal media
npm run typecheck # Type-check the core, desktop layer and tests
npm run build     # Build the interface and compile the desktop code
npm run package   # Unpacked desktop build for the current platform
npm run dist      # Installer for the current platform
```

Build Windows, macOS, and Linux installers on their respective operating systems. Packaging configuration and a three-platform CI workflow are provided; only Linux has been built locally. Signing/notarization credentials and public releases are not configured.

## First workflow

1. Add files or a folder with the buttons, or drop them on the window. Folders are read recursively; hidden entries and symbolic links are skipped. Samples, trailers, and extras are set aside and can be included by hand.
2. Files are grouped by show or film and looked up straight away. Each group is **Suggested** (a clear match), **Check this match** (the closest result, not a certain one), or **Choose a match** (nothing fits, or several fit equally). Nothing is renamed on a suggestion alone.
3. Work down the list on **Review**. Each group shows why it was matched, the alternatives, and every file's new name. Use **Confirm and next**, pick another result, or search again with a different title, type, or source. **Confirm N suggested** confirms all the clear matches at once.
4. **Preview** shows the confirmed groups as a folder tree with counts. Problems such as two files getting the same name are shown on the files involved and block Apply until one is left out.
5. **Apply** opens a native confirmation. Renamed files leave the queue; everything else stays. **History** lists every batch and can undo it.
6. **Settings** holds the naming preset or your own templates, the TMDB token, the language for titles, and the defaults for organising, subtitles, and NFO files.

### Keyboard

| Keys | Action |
| --- | --- |
| `Ctrl`+`1` … `4` (`⌘` on macOS) | Open Review, Preview, History, or Settings |
| `↑` `↓` `Home` `End` | Move through a list when it has focus |
| `Alt`+`↑` / `Alt`+`↓` | Previous or next item in the list, from anywhere |
| `Ctrl`+`Enter` | Confirm and next on Review; Apply on Preview |
| `/` | Jump to the title search on Review |
| `Ctrl`+`O` / `Ctrl`+`Shift`+`O` | Add files / add a folder |
| `Esc` | Close an open form or clear the file selection |
| `?` | Show the shortcut list |

Each list is a single tab stop, page changes move focus to the page heading, outcomes are announced to screen readers, and the interface follows the system light or dark theme.

Examples:

```text
Arrival.2016.1080p.BluRay.x264.mkv
→ Arrival (2016) {tmdb-329865}/Arrival (2016).mkv

Severance.S01E01.2160p.WEB-DL.mkv
→ Severance (2022) {tmdb-95396}/Season 01/Severance (2022) - S01E01 - Good News About Hell.mkv
```

## Metadata and sources

- **TMDB:** Set your own API **read access token** (not the short v3 API key) in Settings. It is encrypted with the operating system's keychain and saved in the app's data folder. Where no keychain is available (some Linux sessions), it is kept in memory until exit and the app says so. No credential is bundled. Films need a TMDB token, apart from anime films, which Kitsu also lists; without one, shows are looked up on TVmaze. [API usage and attribution](https://developer.themoviedb.org/docs/faq).
- **TVmaze:** No key required for the public API. Data is licensed CC BY-SA; attribution and share-alike conditions apply independently of this app's MIT license. [API documentation and license](https://www.tvmaze.com/api).
- **TheTVDB (optional):** Used only to title anime specials that are numbered as TVDB lists them. It needs your own v4 API key, and a subscriber PIN if your key requires one; the key is checked by signing in when you save it, and is stored like the TMDB token. No key is bundled. [API information](https://thetvdb.com/api-information).
- **Kitsu:** An anime catalogue with romaji, English, and Japanese titles and per-episode titles. No key required. It is only used for groups searched as **Anime**, which is how a fansub-style release (a leading `[Group]` tag, or episode numbers with no season) starts out and what the Film, TV, Anime selector on Review sets for any other group. It is used in two ways. First, it is searched along with the other sources, and its results are offered beside theirs on Review. Second, when such a group is not matched with confidence, Kitsu's other titles for it are looked up and every source is searched again under the English one; only an exact title match on Kitsu is trusted. This second search can be turned off in Settings. Each season or part is usually its own entry on Kitsu, numbered from 1; To put those entries in the season Plex expects, the app can use a community-maintained list ([Fribb/anime-lists](https://github.com/Fribb/anime-lists)) that ties Kitsu entries to TMDB and TVDB shows, seasons, and episode offsets. A second part that starts twelve episodes into season 3 is therefore named from `S03E13`, with a `{tmdb-…}` tag. TMDB numbering and tag are used when the list has them, otherwise TVDB's, otherwise the TVDB season Kitsu itself records, otherwise the season the file claims or season 1 with no tag. The list (about 7 MB) is downloaded from GitHub the first time Kitsu is used as a source, reduced to a small checked index in the app's data folder, refreshed weekly, and reused if a refresh fails. This is off by default and turned on in Settings under Sources, because neither list states its terms of use (see the third-party notices); with it off, nothing is downloaded and a Kitsu match keeps its own entry's name, the TVDB season Kitsu itself records where it has one, and otherwise the season the file claims. A later season or part is filed under the show's own name and year, taken from the Kitsu entry the list marks as the show's first, so "Attack on Titan Season 3 Part 2" goes in `Attack on Titan (2013) {tmdb-1429}/Season 03/` beside the rest. The show's poster and backdrop then come from that first entry, and the later entry's own poster is used as the season poster. An entry the list does not know keeps its own name and folder. The list's upstream ([Anime-Lists](https://github.com/Anime-Lists/anime-lists), a further 3.5 MB download) also records the episodes that break an entry's pattern, and those are applied first: a long-running entry split into catalogue seasons by episode range (One Piece's episode 62 becomes `S02E01`), a recap the catalogue files under specials, one episode that the catalogue splits in two, and an episode it does not have at all, which is reported so the file can be set by hand or left out. A multi-episode file that would straddle such a boundary is reported and not misnamed. The rules assume Kitsu numbers an entry's episodes the way AniDB does, which is usual but not guaranteed. A file marked as a special (`S00E02`, a `Specials` folder, or a fansub name such as `[Group] Show - OVA 02` or `Show - SP1`) and matched to a regular Kitsu entry is taken as one of that entry's own specials and placed by the list's rules for them, in the catalogue's specials or wherever it keeps that episode. Kitsu has no titles for these. When the numbers are TMDB's and a TMDB token is set, the title, air date and description come from TMDB's listing of that exact season and episode; When the numbers are TVDB's and you have added your own TVDB API key in Settings, they come from TVDB's listing instead, in the language chosen for titles. Otherwise, or if the catalogue does not list that episode or has no name for it in that language, the name carries the number only. A special the list does not place, or places nowhere, is reported and never numbered as a regular episode; the list often has these rules for TVDB only, so with TMDB numbering in use many specials will be reported this way. For that reason a Kitsu show on Review has a "Number seasons and episodes as" switch between TMDB (the default) and TVDB. TVDB uses that catalogue's seasons, episode numbers and `{tvdb-…}` tag for the whole group, which brings its specials rules into play; the show then needs its episode ordering set to TVDB in Plex, and if you split a show across groups, set them all the same way. Where the list has no TVDB numbering for an entry, TMDB's is used and the group says so. [Kitsu API](https://kitsu.docs.apiary.io).
- **NFO:** Optional Kodi-style XML sidecars contain title, year, plot, provider ID, and episode information. Existing NFO files are never replaced. Naming compatibility does not imply NFO support in every media player. Cross-player integration has not been tested.
- **Subtitles:** Matching same-stem `.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`, and `.idx` files retain suffixes such as `.en.forced`.
- **Artwork:** Optionally (off by default) a poster and a backdrop are downloaded into each title's folder as `poster.jpg` and `fanart.jpg`, names Plex, Jellyfin and Kodi all read; Plex needs "Use local assets" enabled for the library. They are fetched only over HTTPS from TMDB's and TVmaze's own image hosts, must be JPEG, PNG or WebP under 20 MB, and never replace artwork already in the folder. A failed download is reported and skipped; the renames still go ahead. Undo removes the images it saved unless they have since been changed. Artwork needs organising into folders and a template that gives each title its own folder. For shows, each season in the batch also gets its poster beside its episodes as `season01-poster.jpg` (`season-specials-poster.jpg` for specials), skipped if that folder already has a season poster. Images remain subject to their provider's terms.
- **Existing NFO files and artwork** move with their video (on by default). Files named after the video (`Film.nfo`, `Film-poster.jpg`, `Film.fanart.png`) are renamed with it. A film folder's own `poster`, `fanart`, `movie.nfo` and similar, and a season folder's `season01-poster` and similar, move to the new folder when every video in the old folder is going to the same place. They are left behind if any video is staying, if the folder is the one you added, or if the destination already has a file of that name. A show's own files (`tvshow.nfo`, its `poster`, `fanart`, `banner` and similar, and season posters kept in the show folder) move to the new show folder only when the whole show is reorganised: every video under the old show folder, at any depth, is in the batch and they all end up under one title. One episode left out, or an unconfirmed extras folder, keeps them where they are. Where an existing NFO or image is arriving, a new one is not written or downloaded.
- **Episode order:** when a show has other orderings (TMDB's episode groups such as DVD, absolute or story arc; TVmaze's alternate lists such as DVD release), Review offers "Files are numbered in". Choosing one reads the files' season and episode numbers in that order. By default the new names are converted to the usual aired numbering, which is what Plex expects out of the box; "Keep these numbers in the new names" keeps the files' own numbers instead, with the titles of the episodes actually in those positions, for a library set to that order. A multi-episode file whose episodes are not next to each other in aired order can only be named with its own numbers kept. Season posters are not downloaded for groups read in another order.
- **Episodes named by air date** (`Show.2024.03.15.mkv`, `Show - 2024-03-15 - Title.mkv`) are matched to the episode that aired that day and named with its season and episode number like any other. If nothing is listed for that day, or more than one episode aired, the file says so and the season and episode can be set by hand. Dates are matched exactly, so a name dated a day off from the provider's listing will not match. Custom templates can put the date in the name with `{airdate}`, which may stand in for `{season}` and `{episode}`. Dates are read in year-month-day order only.
- Embedded container metadata is not implemented.

Every search sends the entered title and filters to all the sources for that group at once: TMDB when a token is set, TVmaze for shows, and Kitsu for groups searched as anime. A title is never sent to Kitsu otherwise. Their results are ranked together by how well they fit the filename, and the same title from two sources is not treated as a conflict; the source searched first is suggested. A source that cannot be reached is named on the group and the others' results are still offered. Search does not upload media bytes or full local paths. No analytics, accounts, background scans, or automatic rename jobs are included. Provider errors are displayed as errors, not empty successful searches.

## File safety and current limits

- Folder ID tags use the best ID the match has: TMDB, then TVDB, then IMDb. A show matched on TVmaze is tagged `{tvdb-…}` or `{imdb-…}` from the IDs TVmaze lists for it, and gets no tag if it lists neither. Custom templates can use `{idsource}` and `{id}` for this, or `{tmdbid}`, `{tvdbid}` and `{imdbid}` individually.
- By default files are organised into Plex folders (`Show (2022) {tmdb-95396}/Season 01/…`, `Movie (2016) {tmdb-329865}/…`) created inside the folder you imported. An existing folder whose name differs only by case is reused. Turning organising off renames in place. Nothing is moved outside the imported folder or across volumes.
- Plans are created in the main process from imported files and confirmed provider results. The renderer cannot submit arbitrary filesystem operations.
- All targets are checked for existing files and case/Unicode-equivalent names. Duplicate targets and case-only renames are blocked.
- Source size and modification time are checked again before execution and before undo. These checks are not content hashes and cannot detect edits that preserve both values.
- Files use a hard-link-then-unlink operation to avoid rename's overwrite behavior. On filesystems without hard links (exFAT, FAT, many network shares) the app falls back to checking that the destination is free and then renaming; a file created at the destination in the instant between that check and the rename is the one case this cannot rule out. The fallback is covered by tests that simulate the missing hard-link support; it has not yet been run on real exFAT or SMB volumes.
- Journals are flushed before each operation. Interrupted batches can leave both paths referring to the same file. Recovery recognizes that state.
- Batches are **not filesystem transactions**: a failure can leave a partially applied batch. History retains the plan for recovery. Undo can also stop partway at a conflict; earlier reversals remain recorded. No all-or-nothing or power-loss durability guarantee is made.
- Undo refuses changed video files, occupied original paths, and changed NFO contents. This assumes folders are not being concurrently modified by another program; pause other organizers while applying or undoing.
- Journal files in Electron's per-user application data directory contain absolute paths and metadata. They are local and not encrypted. Keep them until you no longer need recovery.
- Multi-episode files (`S01E01E02`, `S01E01-E02`) are named in Plex's `S01E01-E02` form. Fansub-style names with absolute numbers (`[Group] Show - 12`) are parsed, and the engine can convert absolute numbers to seasons by counting through the provider's regular seasons; shows whose provider seasons do not follow that order will map incorrectly. Samples, trailers, and Plex extras folders are flagged. Naming templates are supported by the engine with Plex as the default. Disc structures and music are not supported.
- Grouping can be corrected on Review: tick one or more files and move them to another group or to a new group of their own, or merge a whole group into another. Moved files take on the destination group's match and type.
- A wrongly read or missing season or episode number can be corrected per file on Review; leave the season empty for an absolute episode number. A file whose episode still cannot be found is left where it is.
- Source folders that organising leaves completely empty are removed as part of the batch, listed in Preview, and put back by undo. A folder that still holds anything (samples, artwork, notes, hidden files) is kept, as is the folder you added and any folder files are being moved into. This can be turned off in Settings or Preview.
- The destination for organised folders can be changed to another folder on the same drive. A destination on a different drive is refused.
- Import is limited to 20,000 entries. Lookups run three groups at a time; Review shows how many are done and can cancel the rest. Cancelled groups keep any match they already had and can be searched by hand.

See [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), [validation](docs/VALIDATION.md), and [third-party notices](THIRD_PARTY_NOTICES.md).
