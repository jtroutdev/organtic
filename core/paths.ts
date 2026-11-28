/**
 * The folder every one of the paths lies in, with its trailing separator. Empty when they share
 * none worth naming: no paths, no common folder, or only the root of the disk.
 */
export function commonFolder(paths: readonly string[]): string {
  const folderOf = (path: string) =>
    path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  let shared = paths.length ? folderOf(paths[0]!) : "";
  for (const path of paths.slice(1))
    while (shared && !path.startsWith(shared)) shared = folderOf(shared.slice(0, -1));
  return /^([A-Za-z]:)?[\\/]?$/.test(shared) ? "" : shared;
}

/** A path without the separators it ends with, so a folder compares the same written either way. */
const trimmed = (value: string) => value.replace(/[\\/]+$/, "");

/**
 * Whether `child` is `parent` itself or lies within it. The comparison stops at a separator, so
 * `/media/Show 2` is not inside `/media/Show`, and trailing separators are ignored, so a drive
 * root written `D:\` contains `D:\Films`. An empty parent contains everything.
 */
export function isInside(child: string, parent: string): boolean {
  const root = trimmed(parent);
  if (!root) return true;
  if (!child.startsWith(root)) return false;
  const rest = child.slice(root.length);
  return rest === "" || /^[\\/]/.test(rest);
}

/** Whether `child` lies within `parent` and is not `parent` itself. Use where a folder must be kept. */
export function isBelow(child: string, parent: string): boolean {
  return isInside(child, parent) && trimmed(child) !== trimmed(parent);
}

/**
 * `child` written relative to `parent`, with no leading separator, and empty when they are the
 * same folder. A `child` that is not inside `parent` is returned as it came, minus any leading
 * separator, so a caller that guessed the wrong parent still shows a path rather than a fragment.
 */
export function relativeTo(child: string, parent: string): string {
  const start = isInside(child, parent) ? trimmed(parent).length : 0;
  return child.slice(start).replace(/^[\\/]+/, "");
}
