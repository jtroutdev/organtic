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
- [x] TVDB/IMDb folder tags for TVmaze matches
- [x] Keyboard shortcuts and an automated accessibility audit with no violations
- [x] Optional poster, backdrop and season poster downloads
- [x] Moving existing NFO files and artwork with their video, folder or show
- [x] DVD and other alternate episode orderings
- [x] Episodes named by air date
- [x] Kitsu as an anime provider, and anime title lookup for the other sources
- [x] Kitsu entries placed in their TMDB or TVDB season from a community mapping list, under one folder per show, with per-episode exceptions and the entry's own specials, numbered as TMDB or TVDB lists them, with special titles from TMDB or TVDB

## Next

- Getting an answer from the anime mapping lists' maintainers on terms of use (findings so far are in THIRD_PARTY_NOTICES.md)
- Screen reader and keyboard-only testing by people who rely on them; high-contrast mode review
- Type-checking of Vue templates (vue-tsc does not yet support the TypeScript version in use)

## Before a public stable release

- Execute Windows/macOS/Linux CI and native integration tests on representative local, network, and removable filesystems
- Validate Kodi/Plex/Jellyfin names and metadata against real libraries
- Resolve packaging-tool vulnerability advisories or document a reviewed exception
- Fuzz filename parsing and naming; add more interruption/failure injection and journal recovery tests
- Validate native file dialogs, screen readers, focus order, keyboard-only flow, high-DPI rendering, and large libraries
- Make retryable failures, scan errors, partial recovery, and disk-space conditions easier to inspect
- Application icon, chosen product name, signing/notarization, release checksums, update strategy, contribution/security policies
- Re-review metadata provider terms, attribution, image rights, bundled dependency licenses, and logo use before distributing

## Later

- Embedded video tags using separately managed MKV/MP4 tools, with backups and stream-preservation checks
- CLI powered by the same matching/planning core
- Music and subtitle-fetching providers if these become priorities
- Automation/watch folders only after reliable unattended conflict and recovery behavior exists

## Open product choices

The user selected a desktop-first movie/TV workflow with review and safe previews. NFO sidecars are the provisional first metadata scope; artwork and embedded tag editing are not yet settled. The name is Organtic and the license is MIT. The default library layout is Plex. Commercial distribution, donation/support model, and the first additional provider remain open.
