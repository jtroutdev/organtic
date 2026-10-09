# Validation — October 7, 2026

## Verified locally (Linux)

- **64 tests pass** (`npm test`) on temporary files. They cover parsing (films, episodes, multi-episode files, fansub names, folder hints, samples and extras), grouping and candidate ranking, naming templates and their validation, TVDB and IMDb tags for TVmaze matches, batch episode lookup including absolute numbers, alternate orderings (converted to aired numbering or kept), episodes named by air date, the Kitsu anime provider and anime title lookup, placing Kitsu entries in TMDB or TVDB seasons (validation of the list, offsets, per-episode exceptions, an entry's own specials, caching, offline reuse), planning into Plex folders, case-insensitive folder reuse, removal of emptied source folders, moving existing NFO files and artwork including a whole show's own files, artwork downloads including season posters (planning, refusal of unknown hosts and non-images, a failed download not failing the batch, undo), name clashes, the rename fallback with hard links simulated as unsupported, journaled apply and undo including interrupted batches, and the queue session end to end: import, suggestion states, choosing and searching, exclusion, per-file season and episode correction, splitting and merging groups, lookup progress and cancellation, a changed destination, apply, and what stays queued afterwards.
- **Type check passes** (`npm run typecheck`) for the core, the desktop process, the tests, and the interface's TypeScript modules. Vue templates and component scripts are compiled by Vite but not type-checked.
- **Build passes** (`npm run build`).
- **Desktop bridge:** Electron was started with a temporary profile and the page was driven from the main process. The preload bridge loaded, settings were saved to disk and read back, an invalid template was rejected with its reasons, the keychain was reported as available, preview refused an empty queue, and the bundled fonts loaded. No startup or console errors were logged.
- **Interface in the browser preview:** the full flow was clicked through with example data: grouped review, confirm all suggested, preview with a deliberate name clash, leaving a file out, History, and switching naming presets in Settings. No console errors. Review and Settings were looked at in the dark theme at desktop width.

- **Accessibility audit:** axe-core (WCAG 2.0, 2.1 and 2.2 A/AA rules plus best practices) was run in the browser preview on Review (including its open forms and the empty queue), Preview, History, each Settings section, and the shortcuts dialog, in both light and dark themes. It reports no violations. The only items it could not decide were contrast checks on single digits and arrow glyphs. To repeat it, run `npm run dev` and in the page's console run `await import("/node_modules/axe-core/axe.min.js"); await axe.run()`.
- **Keyboard:** every shortcut was exercised with synthetic key events, and focus was checked after page changes, opening and closing the season and episode form, and list navigation.

- **Live TVmaze artwork addresses:** the search result and image list for one show were fetched; the poster and backdrop are on `static.tvmaze.com` and served as `image/jpeg`, as the code expects.

- **Live TVmaze alternate lists:** the list and its episodes for one show with a DVD order were fetched; the fields match what the code reads.

- **Live Kitsu:** the provider code was run against Kitsu's real API: a search by romaji title, episode titles across two pages, a multi-episode range, alternative titles, a TVDB series and season mapping, and a film search all returned what the code expects.

- **Live anime mapping:** the real list was downloaded and reduced (8,450 Kitsu entries, about 0.7 MB), and three live Kitsu entries were placed with it: a first season, a second part 12 episodes into season 3, and a second season that TMDB lists as a continuation of the first. With the upstream exceptions merged in (836 of those entries carry rules), a long-running show's absolute episodes 61, 62 and 78 came out as S01E61, S02E01 and S03E01, and a file spanning 61 to 62 was refused. 649 entries carry rules for their own specials; live, one entry's special was placed as a regular episode of season 1 as its rule says, and specials with no rule for the numbering in use were reported, not named. With TVDB numbering chosen, a second season came out as S02E02 with a TVDB tag where TMDB numbering gives S01E30, and a special that TMDB numbering reports was placed as S00E01. All three seasons and parts of one show came out under a single show folder with the first entry's name, year and poster.

## Not yet verified

- **The desktop interface on real files.** Native file pickers, drag and drop, the apply and undo confirmations, and a real rename from the window have not been exercised; the same code paths are covered by tests below the window.
- **Season poster naming in Plex.** `season01-poster.jpg` beside the episodes follows Plex's local-assets convention as best recalled; Plex's documentation could not be fetched to confirm it, and no library scan has been run.
- **A real artwork download.** Downloads are tested with a stand-in for the network; no image has been saved through the app, and TMDB image addresses are untested live.
- **Titles for anime specials.** Tested against fixtures only. The TMDB path needs a token, and only three special placements in the current list are in TMDB numbering. The TVDB path needs a key: TVDB's live sign-in was confirmed to reject a made-up key with the response the code handles, and the listing address answers "unauthorized" without a session, but no real listing has been fetched, so the response fields (`seasonNumber`, `number`, `name`, `aired`, `overview`) are from memory of TVDB's API.
- **TMDB episode groups.** The request paths and response fields are written from memory of TMDB's API and tested only against fixtures shaped that way. In particular, a group's `order` is taken as its season number, which holds for typical DVD groups but is set by whoever created the group.
- **Live providers.** TMDB search, season listings, and absolute-number mapping are tested against fixtures only; no token was available. TVmaze was not re-tested live after the batch lookup was added.
- **Real exFAT, FAT, or SMB volumes.** The rename fallback is tested by simulating a failing hard link.
- **Windows and macOS.** The CI matrix is configured but has not run. Keychain storage and path handling there are untested.
- **Screen readers and real keyboard-only use.** The audit is automated and the key presses were synthetic; nobody has used the app with a screen reader or without a mouse. Windows high-contrast mode has styles but was not viewed. Narrow windows were not viewed.
- Installer generation, signing/notarization, and Plex ingestion of the resulting library.

## Dependency audit

`npm audit --omit=dev` reports zero advisories with the current dependencies. The packaging toolchain carried moderate advisories through electron-builder ([GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)) in the initial version; the full audit including development dependencies has not been re-run since.
