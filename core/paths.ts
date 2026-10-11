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
