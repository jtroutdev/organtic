# Roadmap

## Working initial slice

- [x] Independent MIT-licensed Electron/Vue project
- [x] File/folder import and filename hints for movies and numbered TV episodes
- [x] TMDB and TVmaze adapters, manual candidate confirmation, episode-title resolution
- [x] Before/after preview, optional subtitle renaming, Kodi-style NFO creation
- [x] No-overwrite checks, persistent operation journal, interrupted-batch recovery and undo
- [x] Linux unpacked build and browser example preview

## Usable for an entire library (done)

- [x] TypeScript core, desktop process, and interface logic
- [x] Grouped matching with ranked, explained candidates and one confirmation per group
- [x] Plex and Jellyfin naming presets, custom templates, folder organising inside the import root or a chosen folder
- [x] Multi-episode files, fansub-style absolute numbering, season and release folder hints, samples and extras set aside
- [x] Rename fallback for filesystems without hard links
- [x] Queue that survives apply, drag and drop, saved settings, keychain-encrypted token
- [x] Redesigned split-view interface
- [x] Per-file correction of season and episode numbers
- [x] Splitting and merging groups by moving one or several files between them
- [x] Lookup progress and cancellation
- [x] Removing source folders left empty after organising
- [x] TVDB/IMDb folder tags for TVmaze matches (custom templates; the Plex preset has no tag)
- [x] Renaming an imported folder that is itself a title's folder, instead of nesting a second one
- [x] Keyboard shortcuts and an automated accessibility audit with no violations
- [x] Generated-name tests for parsing and naming, and apply and undo stopped at every step and journal record
- [x] Packaging-tool advisories cleared; the full dependency audit is clean
- [x] Failures made plain: what an import could not read, what became of each change in a batch that stopped and why, and a check for a read-only or full disk before anything moves
- [x] Contribution and security policies, with private vulnerability reporting switched on
- [x] A release workflow that builds the installers and drafts a release with their SHA-256 checksums
- [x] Optional poster, backdrop and season poster downloads
- [x] Moving existing NFO files and artwork with their video, folder or show
- [x] DVD and other alternate episode orderings
- [x] Episodes named by air date
- [x] Kitsu as an anime provider, and anime title lookup for the other sources
- [x] Kitsu entries placed in their TMDB or TVDB season from a community mapping list, under one folder per show, with per-episode exceptions and the entry's own specials, numbered as TMDB or TVDB lists them, with special titles from TMDB or TVDB
- [x] Type-checking of Vue templates and component scripts (vue-tsc, run on TypeScript 6 beside the project's TypeScript 7)

## Next

- Getting an answer from the anime mapping lists' maintainers on terms of use (findings so far are in THIRD_PARTY_NOTICES.md)
- Screen reader and keyboard-only testing by people who rely on them; high-contrast mode review

## Before a public stable release

- Run native integration tests on representative local, network, and removable filesystems (CI already runs the type check, tests and a package build on Windows, macOS and Linux for every push)
- Run a batch against a disk that is really full, read-only or unplugged part-way; the check before a batch has only been tested with stand-ins
- Open the Windows and macOS installers the release workflow builds, and see the app and its icon on those platforms; neither has been run
- Validate Kodi/Plex/Jellyfin names and metadata against real libraries
- Validate native file dialogs, screen readers, focus order, keyboard-only flow, high-DPI rendering, and large libraries
- Final application icon, with a version drawn for 16 pixels (a provisional one, redrawn by `scripts/icons.sh` from `public/icon.svg`, is in place), signing/notarization, update strategy
- Decide whether to build for Intel Macs; the release workflow makes an Apple silicon `.dmg` only
- Set `desktopName` so Linux desktops tie the window to its launcher; electron-builder warns that it is missing
- Ask TheTVDB and Kitsu whether the way the app uses their APIs is permitted, and decide the distribution model against TMDB's non-commercial terms (the 12 October 2026 review is in THIRD_PARTY_NOTICES.md)

## Later

- Strict type-checking of Vue templates; it is off because it rejects the attributes components pass through to their root element (`@click`, `aria-label`, `role`)
- Embedded video tags using separately managed MKV/MP4 tools, with backups and stream-preservation checks
- CLI powered by the same matching/planning core
- Music and subtitle-fetching providers if these become priorities
- Moving files to a destination on another drive, share or mount, if users ask for it. Today such a folder is refused when it is chosen, because files move by hard link or rename, which cannot cross filesystems (`noReplaceMove` in `core/files.ts`). It needs a copy-then-delete path with: progress, cancellation and a free-space check; a size or content check before the original is removed; journal and recovery support for a copy cut short; and undo that copies back
- Automation/watch folders only after reliable unattended conflict and recovery behavior exists

## Open product choices

The user selected a desktop-first movie/TV workflow with review and safe previews. NFO sidecars are the provisional first metadata scope; artwork and embedded tag editing are not yet settled. The name is Organtic and the license is MIT. The default library layout is Plex. Commercial distribution, donation/support model, and the first additional provider remain open.
