import test from "node:test";
import assert from "node:assert/strict";
import { commonFolder } from "../core/paths.ts";

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
