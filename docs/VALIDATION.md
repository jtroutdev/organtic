# Validation — November 12, 2026

## Contents

- [Verified locally (Linux)](#verified-locally-linux)
- [Not yet verified](#not-yet-verified)
- [Performance budget](#performance-budget)
- [Dependency audit](#dependency-audit)

## Verified locally (Linux)

- **146 tests pass** (`npm test`) on temporary files. They cover parsing (films, episodes, multi-episode files, fansub names, folder hints, samples and extras), grouping and candidate ranking, naming templates and their validation, TVDB and IMDb tags for TVmaze matches, batch episode lookup including absolute numbers, alternate orderings (converted to aired numbering or kept), episodes named by air date, the Kitsu anime provider and anime title lookup, placing Kitsu entries in TMDB or TVDB seasons (validation of the list, offsets, per-episode exceptions, an entry's own specials, caching, offline reuse), planning into Plex folders, case-insensitive folder reuse, removal of emptied source folders, moving existing NFO files and artwork including a whole show's own files, artwork downloads including season posters (planning, refusal of unknown hosts and non-images, a failed download not failing the batch, undo), in a folder of many videos each subtitle and sidecar going with the longest video name it starts with, a file reached twice in one import listed once, the check before a batch refusing a destination that appeared beside many planned files, name clashes, the rename fallback with hard links simulated as unsupported, journaled apply and undo including interrupted batches, a batch and its undo stopped at every move, a batch and its undo asked to stop during every move (the move in hand finishes, the stop is journaled, and undo, or a second undo, puts back exactly what was there), a batch asked to stop before it begins (nothing changed, no record), a batch longer than one run of 64 announcements (each run announced in full before its first operation is recorded as done, progress reported at the start and after every operation of apply and undo, a stop at and around the end of a run showing the rest as not started and undone exactly, a crash with a run announced and its last records lost undone exactly), Stop from the window stopping the running batch without closing anything, a move announced but never made with another file at its target (passed over at every move, the stranger's file left alone, everything else put back) while a move that was done is still refused when its target changed, the journal format version (written as 1, a record without one read as 1, a newer one refused and left untouched), what closing or quitting during a batch does for each answer to its question (keep open, close when finished, stop and close; asked once, quitting wins over closing, a failed batch or an unshown question), a batch and its undo stopped at every journal record and half-way through a hard link (each compared folder by folder and byte by byte with what was there before), a journal damaged in the middle, an import that meets a folder it may not read or a path that is gone, what History reports for each change of a batch that failed or that the app died in, the check for a read-only or full disk before a batch starts (with the disk's answers stood in for), saving settings (read back whole, no temporary file left, a failed save leaving the saved file as it was) and reading them (none saved, a file cut off, empty or holding an unusable template: the defaults, a reason, and the file kept aside and left alone by the next save), the log (home folder written as `~` but not a longer name that starts the same, tokens and keys hidden, stacks kept, rotation to one older file within the limit, a very long entry cut, a log that cannot be written ignored), the updates the queue sends to the window (after every session test, the window's queue rebuilt from the updates alone equals the session's; changes in one turn go out as one update naming only the groups they touched, an untouched group stays the same object, a removal sends only the new order, a settings change describes every group again; a change to many groups described a slice at a time still goes out as one update that matches the queue when sent, with a group removed or confirmed between slices), and the queue session end to end: import, suggestion states, choosing and searching, exclusion, per-file season and episode correction, splitting and merging groups, lookup progress and cancellation, a changed destination, apply, what stays queued afterwards, and a batch stopped by its checks before its first change, which keeps the whole queue and its confirmations and applies after a fresh preview. Parsing, safe names and templates are also run on 3,000 generated release names per test from a fixed seed (`FUZZ_SEED` and `FUZZ_RUNS` widen it): nothing throws, numbers stay whole, air dates are real days, long repetitive names stay fast, no safe name starts with a dot, a rendered template is one safe name per segment, and an episode named by a preset reads back as the same episode.
- **The documentation is checked by three of those tests** (`tests/docs.test.ts`): `CLAUDE.md` only imports `AGENTS.md`, `AGENTS.md` links every documentation file, and each file lists all of its sections in a contents list within its first 100 lines.
- **Type check passes** (`npm run typecheck`) for the core, the desktop process, the tests, the interface's TypeScript modules, and its Vue templates and component scripts. vue-tsc cannot run on TypeScript 7, so the Vue check uses TypeScript 6, installed beside it as `typescript6`.
- **Build passes** (`npm run build`).
- **Desktop bridge:** Electron was started with a temporary profile and the page was driven from the main process. The preload bridge loaded, settings were saved to disk and read back, an invalid template was rejected with its reasons, the keychain was reported as available, preview refused an empty queue, and the bundled fonts loaded. No startup or console errors were logged. Repeated on Electron 44.11.3 (2026-11-12) with the same results; the page was also confirmed to have no `require` or `process`.
- **Interface in the browser preview:** the full flow was clicked through with example data: grouped review, confirm all suggested, preview with a deliberate name clash, leaving a file out, History, and switching naming presets in Settings. No console errors. Review and Settings were looked at in the dark theme at desktop width.

- **Accessibility audit:** axe-core (WCAG 2.0, 2.1 and 2.2 A/AA rules plus best practices) was run in the browser preview on Review (including its open forms and the empty queue), Preview, History, each Settings section, and the shortcuts dialog, in both light and dark themes. It reports no violations. The only items it could not decide were contrast checks on single digits and arrow glyphs. To repeat it, run `npm run dev` and in the page's console run `await import("/node_modules/axe-core/axe.min.js"); await axe.run()`.
- **Keyboard:** every shortcut was exercised with synthetic key events, and focus was checked after page changes, opening and closing the season and episode form, and list navigation.

- **Live TVmaze artwork addresses:** the search result and image list for one show were fetched; the poster and backdrop are on `static.tvmaze.com` and served as `image/jpeg`, as the code expects.

- **Live TVmaze alternate lists:** the list and its episodes for one show with a DVD order were fetched; the fields match what the code reads.

- **Live Kitsu:** the provider code was run against Kitsu's real API: a search by romaji title, episode titles across two pages, a multi-episode range, alternative titles, a TVDB series and season mapping, and a film search all returned what the code expects.

- **Live anime mapping:** the real list was downloaded and reduced (8,450 Kitsu entries, about 0.7 MB), and three live Kitsu entries were placed with it: a first season, a second part 12 episodes into season 3, and a second season that TMDB lists as a continuation of the first. With the upstream exceptions merged in (836 of those entries carry rules), a long-running show's absolute episodes 61, 62 and 78 came out as S01E61, S02E01 and S03E01, and a file spanning 61 to 62 was refused. 649 entries carry rules for their own specials; live, one entry's special was placed as a regular episode of season 1 as its rule says, and specials with no rule for the numbering in use were reported, not named. With TVDB numbering chosen, a second season came out as S02E02 with a TVDB tag where TMDB numbering gives S01E30, and a special that TMDB numbering reports was placed as S00E01. All three seasons and parts of one show came out under a single show folder with the first entry's name, year and poster.

## Not yet verified

- **The desktop interface on real files.** Native file pickers, drag and drop, the apply and undo confirmations, the question asked when closing or quitting during a batch (and that Electron's close and quit events reach it on each platform), and a real rename from the window have not been exercised; the same code paths are covered by tests below the window.
- **Start-up notices and the log in the desktop window.** The banner for settings that could not be read, the dialog when start-up fails, the log's path and its Show in folder button in Settings, and what Electron writes to the log from a real failure have not been seen in the app; the reading, writing and logging behind them are tested. The About section was looked at in the browser preview, dark theme, where it shows the version and says there is no log.
- **Season poster naming in Plex.** `season01-poster.jpg` beside the episodes follows Plex's local-assets convention as best recalled; Plex's documentation could not be fetched to confirm it, and no library scan has been run.
- **A real artwork download.** Downloads are tested with a stand-in for the network; no image has been saved through the app, and TMDB image addresses are untested live.
- **Titles for anime specials.** Tested against fixtures only. The TMDB path needs a token, and only three special placements in the current list are in TMDB numbering. The TVDB path needs a key: TVDB's live sign-in was confirmed to reject a made-up key with the response the code handles, and the listing address answers "unauthorized" without a session, but no real listing has been fetched, so the response fields (`seasonNumber`, `number`, `name`, `aired`, `overview`) are from memory of TVDB's API.
- **TMDB episode groups.** The request paths and response fields are written from memory of TMDB's API and tested only against fixtures shaped that way. In particular, a group's `order` is taken as its season number, which holds for typical DVD groups but is set by whoever created the group.
- **Live providers.** TMDB search, season listings, and absolute-number mapping are tested against fixtures only; no token was available. TVmaze was not re-tested live after the batch lookup was added.
- **A disk that is really full or read-only.** The check before a batch and the plain wording of system errors are tested with stand-ins; no batch has been run against a full disk, a read-only mount or a drive unplugged part-way. The preview's message for these has not been seen in the desktop window.
- **Real exFAT, FAT, or SMB volumes.** The rename fallback is tested by simulating a failing hard link.
- **Windows and macOS.** CI runs the type check, the tests and an unpacked package build on both, and they pass. The app has not been opened on either; keychain storage, native dialogs and real libraries there are untested.
- **Screen readers and real keyboard-only use.** The audit is automated and the key presses were synthetic; nobody has used the app with a screen reader or without a mouse. Windows high-contrast mode has styles but was not viewed. Narrow windows were not viewed.
- **The release workflow.** The Linux AppImage was built locally and `scripts/checksums.sh` was run on it and on empty, badly named and altered folders. The workflow itself has not run: no Windows or macOS installer has been built, no release has been drafted, and no build provenance attestation has been made or checked with `gh attestation verify`. The commit SHAs the actions are pinned to were read from each action's release tag on 2026-11-12.
- Signing/notarization, and Plex ingestion of the resulting library.

## Performance budget

`npm run bench` builds a library of generated TV episodes in a temporary folder, answers lookups from a stand-in for TMDB so only the app's own work is timed, and times import and lookups, preview, apply, History and undo. It also counts the queue updates sent to the window, how much they come to once serialised, and the longest the main process was held up. `--only small|large|flat` runs one standard library, `--files N --shows N [--flat]` any other, and `--dir` puts the temporary folder on a given disk: the system's temporary folder is often in memory, so use a real disk to compare with the budget.

The budget, agreed on 12 November 2026, for a library at the import limit of **20,000 entries** (files and folders together; about 17,000 episodes in 1,400 show folders) on a local SSD:

| Measure | Budget |
| --- | --- |
| Import and lookups, network stood in for | under 60 s |
| Preview | under 5 s |
| Apply and undo | 2 ms per operation or less |
| Main process held up | never more than 100 ms |
| The window | never unresponsive for more than 100 ms; checked by hand until a window test exists, since the benchmark cannot see it |

The fixes for large libraries come before the public beta, and are measured against this.

Results before any of those fixes, 12 November 2026 (Linux, Node 24, NVMe btrfs):

| Library | Queue updates | Serialised | Import and lookups | Preview | Apply | History | Undo | Main process held up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 files, 50 shows | 152 | 34 MB | 0.6 s | 0.2 s | 6.2 s | 0.0 s | 3.1 s | 11 ms |
| 4,800 files, 400 shows | 1,202 | 2.5 GB | 36.9 s | 3.3 s | 55.0 s | 0.3 s | 28.0 s | 21 ms |
| 3,000 files, 300 shows, one folder | 902 | 1.1 GB | 15.4 s | 8.9 s | 31.2 s | 0.1 s | 15.7 s | 19 ms |
| 17,000 files, 1,400 shows (the import limit) | | | over 16 min, stopped unfinished | | | | | |

Results after the queue sends only what changed (12 November 2026, same machine). Import and lookups meet the budget; preview, apply and undo do not yet, and preview is what holds up the main process:

| Library | Queue updates | Serialised | Import and lookups | Preview | Apply | History | Undo | Main process held up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 files, 50 shows | 1 | 0 MB | 0.1 s | 0.2 s | 9.8 s | 0.0 s | 4.9 s | 13 ms |
| 4,800 files, 400 shows | 1 | 2 MB | 0.5 s | 4.1 s | 56.7 s | 0.3 s | 39.7 s | 78 ms |
| 3,000 files, 300 shows, one folder | 1 | 1 MB | 0.3 s | 8.5 s | 42.2 s | 0.1 s | 16.1 s | 31 ms |
| 17,000 files, 1,400 shows (the import limit) | 1 | 8 MB | 2.7 s | 29.9 s | 195.7 s | 3.1 s | 98.5 s | 205 ms |

Results after planning reads each folder once and finds names by key, names are rendered once per file, and long loops give way to other work (13 November 2026, same machine). Everything meets the budget except apply and undo, about 11 and 6 ms per operation:

| Library | Queue updates | Serialised | Import and lookups | Preview | Apply | History | Undo | Main process held up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 files, 50 shows | 1 | 0 MB | 0.1 s | 0.1 s | 6.0 s | 0.0 s | 3.1 s | 11 ms |
| 4,800 files, 400 shows | 1 | 2 MB | 0.5 s | 0.8 s | 56.4 s | 0.3 s | 28.2 s | 28 ms |
| 3,000 files, 300 shows, one folder | 1 | 1 MB | 0.3 s | 0.4 s | 30.8 s | 0.1 s | 15.7 s | 29 ms |
| 17,000 files, 1,400 shows (the import limit) | 1 | 8 MB | 1.4 s | 2.7 s | 193.7 s | 3.1 s | 98.6 s | 54 ms |

Preview had grown with the square of the files in a folder: each file read its folder again and searched it, and so did the check before a batch. The longest hold-ups left were synchronous: rendering every file's name three times, checking the template each time (189 ms at the import limit), and describing every group at once when all were confirmed together (about 180 ms).

Results after the journal is held open for the batch and operations are announced 64 at a time (14 November 2026, same machine). Everything meets the budget; apply and undo come to about 0.3 and 0.2 ms per operation:

| Library | Queue updates | Serialised | Import and lookups | Preview | Apply | History | Undo | Main process held up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 files, 50 shows | 1 | 0 MB | 0.1 s | 0.2 s | 0.3 s | 0.0 s | 0.1 s | 17 ms |
| 4,800 files, 400 shows | 1 | 2 MB | 0.6 s | 1.3 s | 2.2 s | 0.3 s | 1.1 s | 33 ms |
| 3,000 files, 300 shows, one folder | 1 | 1 MB | 0.4 s | 0.8 s | 1.4 s | 0.1 s | 0.7 s | 38 ms |
| 17,000 files, 1,400 shows (the import limit) | 1 | 8 MB | 1.8 s | 3.6 s | 7.5 s | 4.0 s | 4.3 s | 91 ms |

A flush costs about 4.5 ms on this disk and a move about 0.1 ms, so apply had been two flushes per operation. The 91 ms was reading the 18 MB history record at the start of undo in one go; it now gives way to other work between lines, and a separate measurement put undo's longest hold-up at 57 ms, the plan line alone. The benchmark does not write NFO files: flushed together, they cost about 1.3 ms each on this disk, against 4.3 ms one at a time. History still reads every record in full each time it opens (4.0 s at the import limit); that is a separate fix.

With the network stood in for, every answer arrives before the first update is due, so a whole import goes out as one update; over a real network there are at most about 60 a second. Apply and undo vary from run to run with the disk.

The window, checked by hand in a production build of the browser preview with `?shows=1400` (1,406 groups, about 17,000 files, Chromium, dark and light): no task over 50 ms while the groups loaded and were looked up, and 48 to 56 ms from a click to the next frame when selecting or ticking a group. Before, selecting a group took a 60 to 100 ms task. Progress and Stop were checked by hand in the browser preview, dark only, where a batch is paced over about three seconds: the bar on Preview's summary card, its count and Stop in the footer, the stopped batch's message kept on screen, and History's count and Stop while undoing. They have not been seen in the desktop app.

Before, import grew with the square of the library, because every change sent the whole queue. Apply and undo cost about 11 and 6 ms per operation, mostly opening and flushing the history record; preview is slowest when every file is in one folder. The main process was never held up long: the cost was spread over many updates and landed in the window, which replaced its whole list on each.

## Dependency audit

`npm audit` reports zero advisories, development dependencies included (run 2026-11-12). CI runs `npm audit --audit-level=high` on every pull request and push to `main`, so a new high or critical advisory fails the build; moderate and low ones are left to Dependabot's alerts. Electron is 44.11.3; releases before 44.9.1 carry [GHSA-jr5w-w6x2-84p9](https://github.com/advisories/GHSA-jr5w-w6x2-84p9), and Electron is the one audited package that ships in the app. Two `overrides` in `package.json` keep the packaging toolchain clean:

- **`global-agent`.** [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) in sprintf-js (moderate) has no fixed release. It arrived through electron-builder's copy of `@electron/get`, whose optional proxy helper `global-agent` 3 logs with it. The override pins `global-agent` to version 4, which no longer depends on it; remove it once electron-builder ships an `@electron/get` that does not need it.
- **`minimatch`.** [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (moderate, denial of service from a crafted pattern) is in versions 7 to 11.0.0. electron-builder's `app-builder-lib` asks for version 10 and `@electron/universal` for version 9, and no release of either asks for a fixed one, so the override gives both 11.0.1 or later; other packages keep the unaffected versions 3 and 5 they ask for. Both use it only to match file patterns from the build configuration. With the override in place the unpacked Linux package was built and its contents were as configured, with the default exclusions still applied. `@electron/universal` runs only for a macOS universal build, which was not run. Remove the override once electron-builder asks for a fixed minimatch.

None of the overridden packages is in the packaged app.
