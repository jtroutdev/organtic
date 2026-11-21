import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Providers } from "../core/providers.ts";
import { Keys, TOKEN_FILE, TVDB_FILE } from "../desktop/keys.ts";
import type { Keychain } from "../desktop/keys.ts";
import { fakeKeychain, tvdbLogin } from "./standIns.ts";

async function setup(
  t: TestContext,
  keychain: Keychain = fakeKeychain(),
  platform: NodeJS.Platform = "linux",
) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "organtic-keys-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const secrets: string[] = [];
  const make = () => {
    const providers = new Providers({ fetcher: tvdbLogin });
    return {
      providers,
      keys: new Keys({ keychain, platform, folder, providers, secret: (value) => secrets.push(value) }),
    };
  };
  const exists = (name: string) =>
    fs.access(path.join(folder, name)).then(() => true, () => false);
  return { folder, secrets, make, exists, ...make() };
}

test("a token is saved encrypted, only its owner can read the file, and it is read back", async (t) => {
  const { folder, keys, make, secrets } = await setup(t);
  assert.equal(keys.canSave, true);
  assert.deepEqual(await keys.setToken("  abc123  "), { tmdb: "saved", tvdb: "none", canSave: true });
  const written = await fs.readFile(path.join(folder, TOKEN_FILE));
  assert.ok(!written.includes("abc123"), "the token was written in plain text");
  if (process.platform !== "win32")
    assert.equal((await fs.stat(path.join(folder, TOKEN_FILE))).mode & 0o777, 0o600);
  assert.ok(secrets.includes("  abc123  "), "the token was not hidden from the log");

  const again = make();
  await again.keys.load();
  assert.equal(again.providers.hasToken, true);
  assert.equal(again.keys.sources().tmdb, "saved");
});

test("without a keychain a key is held for the session and never written", async (t) => {
  const { keys, exists } = await setup(t, fakeKeychain({ available: false }));
  assert.equal(keys.canSave, false);
  assert.equal((await keys.setToken("abc123")).tmdb, "session");
  assert.equal((await keys.setTvdbKey("good", "")).sources.tvdb, "session");
  assert.equal(await exists(TOKEN_FILE), false);
  assert.equal(await exists(TVDB_FILE), false);
});

test("Linux's plain-text fallback is not treated as a keychain", async (t) => {
  const { keys, exists } = await setup(t, fakeKeychain({ backend: "basic_text" }));
  assert.equal(keys.canSave, false);
  assert.equal((await keys.setToken("abc123")).tmdb, "session");
  assert.equal(await exists(TOKEN_FILE), false);
  // The same backend name means nothing elsewhere.
  const other = await setup(t, fakeKeychain({ backend: "basic_text" }), "darwin");
  assert.equal(other.keys.canSave, true);
});

test("an empty token removes the saved one", async (t) => {
  const { keys, exists } = await setup(t);
  await keys.setToken("abc123");
  assert.equal(await exists(TOKEN_FILE), true);
  assert.equal((await keys.setToken("")).tmdb, "none");
  assert.equal(await exists(TOKEN_FILE), false);
});

test("a TVDB key that TVDB refuses is not kept, and replaces a saved one", async (t) => {
  const { keys, providers, exists, make } = await setup(t);
  assert.equal((await keys.setTvdbKey("good", "1234")).sources.tvdb, "saved");
  assert.equal(await exists(TVDB_FILE), true);

  const result = await keys.setTvdbKey("wrong", "");
  assert.match(result.refused ?? "", /TVDB rejected that key/);
  assert.equal(result.sources.tvdb, "none");
  assert.equal(providers.hasTvdbKey, false);
  assert.equal(await exists(TVDB_FILE), false);
  const again = make();
  await again.keys.load();
  assert.equal(again.providers.hasTvdbKey, false);
});

test("a TVDB key that cannot be checked is not kept either, and the reason is passed on", async (t) => {
  const { keys, providers, exists } = await setup(t);
  await assert.rejects(keys.setTvdbKey("offline", ""), /Could not reach TVDB/);
  assert.equal(providers.hasTvdbKey, false);
  assert.equal(await exists(TVDB_FILE), false);
});

test("a saved TVDB key and PIN are read back and hidden from the log", async (t) => {
  const { keys, make, secrets } = await setup(t);
  await keys.setTvdbKey("good", "1234");
  secrets.length = 0;
  const again = make();
  await again.keys.load();
  assert.equal(again.keys.sources().tvdb, "saved");
  assert.deepEqual(secrets, ["good", "1234"]);
});

test("a key this keychain cannot read is passed over", async (t) => {
  const { folder, keys } = await setup(t);
  await fs.writeFile(path.join(folder, TOKEN_FILE), "written by another keychain");
  await keys.load();
  assert.equal(keys.sources().tmdb, "none");
});
