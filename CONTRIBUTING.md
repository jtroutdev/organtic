# Contributing

Thanks for looking. Organtic is an early project with one maintainer, so the aim of this page is to keep everyone's time well spent.

## Before you write code

- **Found a bug?** [Open an issue](https://github.com/jtroutdev/organtic/issues/new) with the file names involved (made-up ones are fine), what you expected and what happened. A file name the app reads wrongly is a useful report all by itself.
- **A small fix** (a typo, a wrongly parsed name, a clear bug with a test) can go straight to a pull request.
- **Anything larger** (a new feature, a new metadata source, a change to how files are moved or recorded, a redesign) starts as an issue. Agree the approach there first. A large pull request that arrives unannounced may be closed even if the code is good.
- **A security problem** is reported privately. See [SECURITY.md](SECURITY.md).

The [roadmap](docs/ROADMAP.md) says what is planned, and [validation](docs/VALIDATION.md) says what has and has not been tested.

## Setting up

Node.js 24 or later.

```sh
npm ci
npm run dev        # Browser preview on example files; touches nothing on disk
npm start          # The desktop app
```

Before opening a pull request, all three of these pass:

```sh
npm run typecheck
npm test
npm run build
```

CI runs the same checks, and an unpacked package build, on Linux, Windows and macOS.

## What a change needs

- **Tests for anything in `core/`.** They run on temporary files and never on personal media. A parsing fix comes with the file name that was read wrongly. A change to applying, undoing or the history record comes with a test that stops it part-way; `tests/recovery.test.ts` shows how.
- **No file is ever replaced, and nothing moves that the preview did not show.** A change that weakens either will not be merged.
- **The interface does not touch the filesystem.** It sends group keys, file IDs and choices; `core/` and `desktop/` do the rest. See [architecture](docs/ARCHITECTURE.md).
- **Interface changes follow [DESIGN.md](DESIGN.md)**: dark theme first, the existing colour, spacing and type variables, grid for layout. Say in the pull request which screens you looked at and in which theme.
- **Keyboard and screen reader support stay intact.** A new control is reachable by keyboard and has a name.
- **No credentials.** No API token or key is bundled or committed, including in tests and fixtures.
- **New dependencies need a reason.** Say what it is for and why the standard library or what is already here will not do. `npm audit` stays clean.
- **Docs move with the code.** Update the README when behaviour changes, and the roadmap and validation notes when an item is finished or newly untested.

## Branches, commits and pull requests

- Branch from `main`, named by the kind of work: `fix/…`, `feature/…`, `bug/…`.
- One subject per pull request. Two unrelated fixes are two pull requests.
- Write the commit subject as a plain sentence saying what the change does ("Refuse impossible air dates"), and use the body for why.
- In the pull request, say what you checked and what you did not.

## Licence

Organtic is [MIT licensed](LICENSE). By contributing you agree that your contribution is under the same licence, and that it is your own work or you have the right to submit it. Do not copy code, assets or algorithms from FileBot or from other projects whose licences do not allow it. Data from metadata sources keeps its own terms; see the [third-party notices](THIRD_PARTY_NOTICES.md).

## Conduct

Be respectful, assume good faith, and keep discussion about the project. Harassment, insults and personal attacks are not welcome. The maintainer may edit or remove comments and block accounts that do not keep to this. To raise a concern privately, use the same private report form as [SECURITY.md](SECURITY.md) describes.
