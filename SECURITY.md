# Security policy

Organtic renames and moves files on your own computer, so a mistake here can cost someone their library. Reports are taken seriously.

## Contents

- [Reporting a problem](#reporting-a-problem)
- [What counts](#what-counts)
- [What does not](#what-does-not)
- [Supported versions](#supported-versions)

## Reporting a problem

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to [the report form](https://github.com/jtroutdev/organtic/security/advisories/new). Only the maintainer can see the report.

Do not open a public issue for a security problem, and do not include real tokens, API keys or personal file listings in a report.

A good report says:

- the version or commit, and the operating system;
- what you did, step by step, with the smallest example that shows it;
- what happened, and what you expected;
- what someone could do with it.

Organtic has one maintainer working in spare time. Expect a first reply within about a week. You will be told whether the report is accepted, and when a fix is out. If you would like credit in the fix's notes, say how you want to be named.

## What counts

- A file renamed, moved, replaced or deleted outside what the preview showed, or outside the folders chosen for the batch.
- An existing file overwritten.
- A way for the interface, a file name, a folder name or a metadata source's answer to make the app read or write a path it was not given.
- A saved TMDB token or TVDB key exposed: written unencrypted where a keychain is available, logged, or sent anywhere other than its own service.
- Artwork or lists fetched from a host other than the ones the app names, or a download that escapes its limits on size and type.
- Code from a web page or a metadata source running inside the app.
- A dependency with a known vulnerability that reaches the packaged app.

## What does not

- The metadata sources themselves (TMDB, TVmaze, TheTVDB, Kitsu) and the community anime lists. Report problems with those to their owners.
- Limits the README already states under "File safety and current limits": a batch is not a filesystem transaction, the history records are local and unencrypted, and source checks compare size and modification time, not content.
- Problems that need another program changing the same folders while a batch is applied or undone.
- Someone who already has your user account on the computer.

## Supported versions

There are no public releases yet. Fixes go to the `main` branch only. Once releases exist, the latest one will be the supported one.
