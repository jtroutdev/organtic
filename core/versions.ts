import { readQuality } from "./parse.ts";
import type { ParsedName, Selection } from "./types.ts";

const key = (name: string) => name.normalize("NFC").toLowerCase();

/** Whether two filenames could be the same episode: they disagree only if both give a number. */
function sameEpisode(a: ParsedName, b: ParsedName) {
  if (a.episode === null || b.episode === null) return true;
  if (a.season === b.season) return a.episode === b.episode;
  if (a.season !== null && b.season !== null) return false;
  // One has no season: "812" beside S08E12, or a bare "E12".
  const whole = (p: ParsedName) => (p.season ?? 0) * 100 + p.episode!;
  return a.episode === b.episode || whole(a) === whole(b);
}

export interface Version {
  /** What follows the plain name: "720p x264", "Copy 2". */
  label: string;
  /** Why, for the preview. */
  note: string;
}

/**
 * Copies of one title that would all take the same name. The best keeps it; each other is
 * named as a further version, "Name - 720p x264", from whatever its release name says that
 * the best one's does not, or "Name - Copy 2" when the names give nothing to tell them apart.
 * Files that look like different episodes are left alone, so the clash is reported.
 *
 * `nameOf` gives the path a file would take, without its extension; it may throw for a file
 * that cannot be named, which is then reported when the file itself is planned.
 */
export function nameVersions(
  selections: Selection[],
  nameOf: (selection: Selection) => string,
): Map<Selection, Version> {
  const sharing = new Map<string, Selection[]>();
  for (const selection of selections) {
    try {
      const name = key(nameOf(selection));
      sharing.set(name, [...(sharing.get(name) ?? []), selection]);
    } catch {
      // Not nameable: nothing to share.
    }
  }
  const versions = new Map<Selection, Version>();
  for (const copies of sharing.values()) {
    if (
      copies.length < 2 ||
      new Set(copies.map(({ file }) => file.path)).size !== copies.length ||
      copies.some(({ file: a, media }) =>
        copies.some(({ file: b }) => media.kind === "tv" && !sameEpisode(a.parsed, b.parsed)),
      )
    )
      continue;
    const ranked = copies
      .map((selection) => {
        const { file } = selection;
        // The file's own name first, then the two folders nearest to it inside its root.
        const folders = file.path.slice(file.root.length).split(/[\\/]/).filter(Boolean);
        const names = [file.name.replace(/\.[^.]+$/, ""), ...folders.slice(0, -1).reverse()];
        return { selection, file, ...readQuality(...names.slice(0, 3)) };
      })
      .sort(
        (a, b) =>
          b.rank[0] - a.rank[0] ||
          b.rank[1] - a.rank[1] ||
          b.rank[2] - a.rank[2] ||
          b.file.size - a.file.size,
      );
    const [best, ...rest] = ranked;
    const used = new Set<string>();
    let copy = 1;
    for (const { selection, file, labels } of rest) {
      const told = labels
        .filter((label, slot) => label && label !== best!.labels[slot])
        .join(" ");
      const label = told && !used.has(key(told)) ? told : `Copy ${++copy}`;
      used.add(key(label));
      versions.set(selection, {
        label,
        note:
          label === told
            ? `named as another version of "${best!.file.name}"`
            : file.size === best!.file.size
              ? `likely an exact duplicate of "${best!.file.name}"`
              : `named as a copy of "${best!.file.name}"`,
      });
    }
  }
  return versions;
}
