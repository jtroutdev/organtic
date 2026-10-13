#!/bin/sh
# Writes SHA256SUMS.txt for every installer in a folder, then checks the list against the files.
# Usage: scripts/checksums.sh <folder>
set -eu
cd "$1"
found=$(find . -maxdepth 1 -type f \( -name '*.AppImage' -o -name '*.dmg' -o -name '*.exe' \) | sed 's|^\./||' | LC_ALL=C sort)
if [ -z "$found" ]; then
  echo "No installers in $1." >&2
  exit 1
fi
# Names must survive a release upload unchanged, or the list would not match the downloads.
if printf '%s\n' "$found" | grep -q '[^A-Za-z0-9._-]'; then
  echo "An installer's name has a character GitHub would change:" >&2
  printf '%s\n' "$found" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  sum() { sha256sum "$@"; }
else
  sum() { shasum -a 256 "$@"; }
fi
printf '%s\n' "$found" | while IFS= read -r name; do sum "$name"; done > SHA256SUMS.txt
sum -c SHA256SUMS.txt
