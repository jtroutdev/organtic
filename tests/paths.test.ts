import test from "node:test";
import assert from "node:assert/strict";
import { commonFolder, isBelow, isInside, relativeTo } from "../core/paths.ts";

test("the common folder is the deepest one every path lies in", () => {
  assert.equal(
    commonFolder([
      "/media/tv/Severance.S01/Severance.S01E01.mkv",
      "/media/tv/Severance (2022)/Season 01/Severance (2022) - S01E01.mkv",
      "/media/tv/Severance (2022)",
    ]),
    "/media/tv/",
  );
  // A folder is not confused with a longer name that starts the same way.
  assert.equal(commonFolder(["/media/tv/a.mkv", "/media/tv2/b.mkv"]), "/media/");
  assert.equal(commonFolder(["C:\\Media\\TV\\a.mkv", "C:\\Media\\Films\\b.mkv"]), "C:\\Media\\");
  assert.equal(commonFolder(["/media/tv/a.mkv"]), "/media/tv/");
});

test("paths that share only the root, or nothing, have no common folder", () => {
  assert.equal(commonFolder([]), "");
  assert.equal(commonFolder(["/media/a.mkv", "/backup/a.mkv"]), "");
  assert.equal(commonFolder(["C:\\a.mkv", "C:\\Media\\b.mkv"]), "");
  assert.equal(commonFolder(["C:\\Media\\a.mkv", "D:\\Media\\a.mkv"]), "");
});

test("a path is inside a folder only at a separator boundary", () => {
  assert.equal(isInside("/media/Show/Season 01", "/media/Show"), true);
  assert.equal(isInside("/media/Show", "/media/Show"), true, "a folder is inside itself");
  // The sibling whose name starts the same way is not inside.
  assert.equal(isInside("/media/Show 2/Empty", "/media/Show"), false);
  assert.equal(isInside("/media/ShowX", "/media/Show"), false);
  assert.equal(isInside("C:\\Media\\Show\\a.mkv", "C:\\Media\\Show"), true);
  assert.equal(isInside("C:\\Media\\Show 2\\a.mkv", "C:\\Media\\Show"), false);
});

test("a folder written with a trailing separator still contains its own files", () => {
  // fs.realpath of a Windows drive root keeps its separator, so the boundary must survive it.
  assert.equal(isInside("D:\\Films\\a.mkv", "D:\\"), true);
  assert.equal(isInside("D:\\", "D:\\"), true);
  assert.equal(isBelow("D:\\Films", "D:\\"), true);
  assert.equal(isInside("/media/Show/a.mkv", "/media/Show/"), true);
  assert.equal(isInside("/media/Show/", "/media/Show"), true);
  assert.equal(isInside("/media/a.mkv", "/"), true);
  assert.equal(isInside("/media/a.mkv", ""), true, "no folder named means no boundary to fail");
});

test("a folder that must be kept is not below itself", () => {
  assert.equal(isBelow("/media/Show", "/media/Show"), false);
  assert.equal(isBelow("/media/Show/", "/media/Show"), false);
  assert.equal(isBelow("D:\\", "D:\\"), false);
  assert.equal(isBelow("/media/Show/Season 01", "/media/Show"), true);
  assert.equal(isBelow("/media/Show 2", "/media/Show"), false);
});

test("a path relative to its folder drops the folder and the separator", () => {
  assert.equal(relativeTo("/media/Show/Season 01/a.mkv", "/media/Show"), "Season 01/a.mkv");
  assert.equal(relativeTo("/media/Show/a.mkv", "/media/Show/"), "a.mkv");
  assert.equal(relativeTo("D:\\Films\\a.mkv", "D:\\"), "Films\\a.mkv");
  assert.equal(relativeTo("/media/Show", "/media/Show"), "", "the folder itself is nothing relative to itself");
  // The sibling keeps its own path rather than being cut at the wrong place.
  assert.equal(relativeTo("/media/Show 2/Empty", "/media/Show"), "media/Show 2/Empty");
  assert.equal(relativeTo("/media/a.mkv", ""), "media/a.mkv");
});
