# Agents

The starting point for any coding agent working on Organtic, and the root of the project's documentation: every other documentation file is listed here, and is read because this file sent you to it.

## Contents

- [What this is](#what-this-is)
- [Documentation map](#documentation-map)
- [Before changing the interface](#before-changing-the-interface)
- [Rules that always hold](#rules-that-always-hold)
- [Commands](#commands)
- [Branches, commits and pull requests](#branches-commits-and-pull-requests)
- [Keeping the documentation in shape](#keeping-the-documentation-in-shape)

## What this is

Organtic is a local-first desktop app that matches movie and TV files to a catalogue and renames them safely. Electron and Vue, TypeScript throughout.

| Folder     | What is in it                                                                 |
| ---------- | ----------------------------------------------------------------------------- |
| `core/`    | Parsing, grouping, naming, providers, planning, the journal. No interface code |
| `desktop/` | The Electron main process and the preload bridge                              |
| `src/`     | The Vue interface: pages, components, one store, `style.css`                  |
| `tests/`   | Node's test runner, on temporary files only                                   |
| `docs/`    | Architecture and validation notes                                             |

## Documentation map

Read the file that matches the work before starting it. Each one opens with its own contents.

| File                                             | Read it when                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| [DESIGN.md](DESIGN.md)                           | Changing anything a person sees: `src/`, `index.html`, a component, a style   |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     | Changing `core/` or `desktop/`, the IPC contract, the journal or a provider   |
| [docs/VALIDATION.md](docs/VALIDATION.md)         | Claiming something is tested, or adding or removing a test                    |
| [CONTRIBUTING.md](CONTRIBUTING.md)               | Opening a pull request; what a change needs before it merges                  |
| [SECURITY.md](SECURITY.md)                       | Touching paths, tokens, downloads or anything a report could be about         |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Adding a dependency, a font, a metadata source or its artwork                 |
| [README.md](README.md)                           | Changing behaviour a user would notice; it is the user's manual               |

`CLAUDE.md` holds no instructions of its own. It imports this file.

## Before changing the interface

Read [DESIGN.md](DESIGN.md) before editing any file in `src/` or `index.html`, every time, however small the change. Its front matter holds the token values and its prose holds the rules; the contents are in a comment at the top of the file, and the Do's and Don'ts at the end are the list to check a change against.

The rules most often broken, all of which DESIGN.md states in full:

- Dark is the design. Build and review in dark; light is derived afterwards.
- Grid and `overflow` for page structure and scroll regions. Flex only for content flow inside a component.
- The window never scrolls; only lists do. Vertical space is the scarcest thing.
- Space by density (24 / 16 / 8 / 4) with spacing variables, from `gap` first, then `padding`, never margin.
- A component's rules live in its own scoped style block. `src/style.css` is for what the whole app shares. No inline styles.
- Colours are oklch tokens. No raw colour, size or duration in a component rule.

When a change settles a new design rule or alters one, update DESIGN.md in the same change.

## Rules that always hold

- No file is ever replaced, and nothing moves that the preview did not show.
- The interface does not touch the filesystem. It sends group keys, file IDs and choices; `core/` and `desktop/` do the rest.
- Anything in `core/` comes with tests, and tests never run on personal media.
- No API token or key is bundled or committed, including in tests and fixtures.
- A new dependency needs a stated reason, and `npm audit` stays clean.
- Keyboard and screen reader support stay intact: a new control is reachable by keyboard and has a name.
- The roadmap is kept outside the repository. Do not add a roadmap or planning file here.

[CONTRIBUTING.md](CONTRIBUTING.md) gives the reasons and the detail.

## Commands

Node.js 24 or later.

```sh
npm ci
npm run dev        # Browser preview on example files; touches nothing on disk
npm start          # Build and launch the desktop app
npm run typecheck
npm test
npm run build
```

Type check, tests and build all pass before a pull request is opened.

## Branches, commits and pull requests

- Branch from `main`, named by the kind of work: `fix/…`, `feature/…`, `bug/…`, `docs/…`. Never a prefix that names the tool or agent that made it.
- One subject per pull request.
- The commit subject is a plain sentence saying what the change does; the body says why.
- Say in the pull request what was checked and what was not. For an interface change, say which screens were looked at and in which theme.

## Keeping the documentation in shape

- Every documentation file is listed in the [documentation map](#documentation-map). A new one is added there in the same change that creates it.
- Every documentation file has a contents list within its first 100 lines, so an agent reading only the top of the file knows what is in it and where. DESIGN.md keeps its contents as a comment at the top of its front matter.
- When a heading is added, renamed or removed, its file's contents list changes with it.
- Docs move with the code: the README when behaviour changes, the validation notes when something is newly tested or newly untested.
- `tests/docs.test.ts` checks the first three of these.
