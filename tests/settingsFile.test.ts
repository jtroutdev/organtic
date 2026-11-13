import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS, mergeSettings } from "../core/settings.ts";
import { readSettings, writeSettings, UNREADABLE_NAME } from "../desktop/settingsFile.ts";

async function folder(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "organtic-settings-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const custom = mergeSettings({
  preset: "custom",
  templates: { movie: "{title} [{year}]", episode: "{title}/{title} {season}x{episode:00}" },
  nfo: true,
});

test("no saved settings means the defaults, with nothing to report", async (t) => {
  const dir = await folder(t);
  assert.deepEqual(await readSettings(path.join(dir, "settings.json")), {
    settings: DEFAULT_SETTINGS,
  });
});

test("settings written are read back, and no temporary file is left", async (t) => {
  const dir = await folder(t);
  const file = path.join(dir, "settings.json");
  await writeSettings(file, DEFAULT_SETTINGS);
  await writeSettings(file, custom);
  assert.deepEqual(await readSettings(file), { settings: custom });
  assert.deepEqual(await fs.readdir(dir), ["settings.json"]);
});

for (const [name, text] of [
  ["that is cut off part-way", '{"preset": "custom", "templates": {"movie": "{ti'],
  ["that is empty", ""],
  ["that holds an unusable template", '{"preset": "custom", "templates": {"movie": "{nonsense}"}}'],
] as const)
  test(`a settings file ${name} gives the defaults, says so, and is kept aside`, async (t) => {
    const dir = await folder(t);
    const file = path.join(dir, "settings.json");
    await fs.writeFile(file, text);
    const read = await readSettings(file);
    assert.deepEqual(read.settings, DEFAULT_SETTINGS);
    assert.ok(read.problem instanceof Error);
    assert.equal(read.kept, true);
    assert.equal(await fs.readFile(path.join(dir, UNREADABLE_NAME), "utf8"), text);
    // The next start is quiet, and the next save leaves the kept file alone.
    assert.deepEqual(await readSettings(file), { settings: DEFAULT_SETTINGS });
    await writeSettings(file, custom);
    assert.equal(await fs.readFile(path.join(dir, UNREADABLE_NAME), "utf8"), text);
  });

test("a failed save leaves the saved settings as they were", async (t) => {
  const dir = await folder(t);
  const file = path.join(dir, "settings.json");
  await writeSettings(file, custom);
  // A folder where the file should be makes the rename fail after the write succeeded.
  const blocked = path.join(dir, "blocked");
  await fs.mkdir(path.join(blocked, "settings.json"), { recursive: true });
  await assert.rejects(writeSettings(path.join(blocked, "settings.json"), DEFAULT_SETTINGS));
  assert.deepEqual(await fs.readdir(blocked), ["settings.json"]);
  assert.deepEqual(await readSettings(file), { settings: custom });
});
