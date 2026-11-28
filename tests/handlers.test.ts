import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MessageBoxOptions, OpenDialogOptions } from "electron";
import { Providers } from "../core/providers.ts";
import { Session } from "../core/session.ts";
import { createPlan, applyPlan } from "../core/files.ts";
import { DEFAULT_SETTINGS } from "../core/settings.ts";
import { AppLog } from "../desktop/appLog.ts";
import { ExitGuard } from "../desktop/exitGuard.ts";
import { registerHandlers, SETTINGS_FILE, LAST_FOLDER_FILE } from "../desktop/handlers.ts";
import type { AppWindow, Sender } from "../desktop/handlers.ts";
import { Keys, TOKEN_FILE, TVDB_FILE } from "../desktop/keys.ts";
import type { Keychain } from "../desktop/keys.ts";
import { fakeKeychain, tvdbLogin } from "./standIns.ts";

const UI_URL = "file:///app/dist/index.html";

type Listener = (event: Sender, ...args: unknown[]) => Promise<unknown>;

/**
 * The handlers registered against stand-ins for Electron: an `ipcMain` that records its
 * listeners, a window, dialogs whose answers the test sets, and a shell that records what it
 * was asked to open. `call` sends a request from the window's own page.
 */
async function setup(
  t: TestContext,
  options: { keychain?: Keychain; notice?: string } = {},
) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "organtic-handlers-"));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const journalDir = path.join(userData, "history");

  const listeners = new Map<string, Listener>();
  const ipc = { handle: (channel: string, listener: Listener) => void listeners.set(channel, listener) };
  const mainFrame = { url: UI_URL };
  const sent: [string, unknown][] = [];
  const window: AppWindow = {
    webContents: { mainFrame, send: (channel, payload) => void sent.push([channel, payload]) },
  };
  let open: AppWindow | undefined = window;
  const answers = { messageBox: 1, openDialog: { canceled: true, filePaths: [] as string[] } };
  const boxes: MessageBoxOptions[] = [];
  const pickers: OpenDialogOptions[] = [];
  const opened: string[] = [];
  const shown: string[] = [];

  const providers = new Providers({ fetcher: tvdbLogin, limits: {} });
  const log = new AppLog({ file: path.join(userData, "logs", "organtic.log"), home: os.homedir() });
  const keys = new Keys({
    keychain: options.keychain ?? fakeKeychain(),
    platform: "linux",
    folder: userData,
    providers,
    secret: (value) => log.secret(value),
  });
  const session = new Session({
    providers,
    settings: DEFAULT_SETTINGS,
    planner: { createPlan, applyPlan: (plan) => applyPlan(plan, journalDir) },
    defer: (flush) => flush(),
  });
  const guard = new ExitGuard({ ask: async () => "keep", exit: () => {} });
  const animeMap = { enabled: DEFAULT_SETTINGS.animeSeasons };

  await registerHandlers({
    ipc,
    dialogs: {
      showMessageBox: async (box) => (boxes.push(box), { response: answers.messageBox, checkboxChecked: false }),
      showOpenDialog: async (picker) => (pickers.push(picker), answers.openDialog),
    },
    shell: {
      openExternal: async (url) => void opened.push(url),
      showItemInFolder: (file) => void shown.push(file),
    },
    window: () => open,
    uiUrl: UI_URL,
    userData,
    journalDir,
    session,
    keys,
    animeMap,
    log,
    guard,
    version: "0.1.0",
    settings: DEFAULT_SETTINGS,
    ...(options.notice ? { notice: options.notice } : {}),
  });

  const fromWindow: Sender = { sender: window.webContents, senderFrame: mainFrame };
  const send = (event: Sender, name: string, ...args: unknown[]) => {
    const listener = listeners.get(`media:${name}`);
    assert.ok(listener, `nothing handles media:${name}`);
    return listener(event, ...args);
  };
  const exists = (name: string) =>
    fs.access(path.join(userData, name)).then(() => true, () => false);
  const logged = () => fs.readFile(log.file, "utf8").catch(() => "");
  return {
    userData,
    listeners,
    window,
    mainFrame,
    sent,
    answers,
    boxes,
    pickers,
    opened,
    shown,
    providers,
    session,
    guard,
    animeMap,
    log,
    exists,
    logged,
    closeWindow: () => (open = undefined),
    call: (name: string, ...args: unknown[]) => send(fromWindow, name, ...args),
    send,
  };
}

test("every request the preload bridge offers has a handler", async (t) => {
  const { listeners } = await setup(t);
  const preload = await fs.readFile(path.join(import.meta.dirname, "../desktop/preload.cjs"), "utf8");
  const names = [...preload.matchAll(/invoke\("([A-Za-z]+)"\)|^\s+"([A-Za-z]+)",$/gm)].map(
    ([, invoked, listed]) => invoked ?? listed,
  );
  assert.ok(names.length > 20, "the preload's request names were not found");
  for (const name of names) assert.ok(listeners.has(`media:${name}`), `media:${name} has no handler`);
});

test("a request from anywhere but the interface's own page is refused, logged, and not acted on", async (t) => {
  const { send, window, mainFrame, opened, logged, closeWindow } = await setup(t);
  const otherPage = { url: "https://example.com/" };
  const untrusted: [string, Sender][] = [
    ["another window", { sender: {}, senderFrame: mainFrame }],
    ["a frame inside the page", { sender: window.webContents, senderFrame: { url: UI_URL } }],
    ["the main frame showing another page", { sender: window.webContents, senderFrame: otherPage }],
    ["a frame that has gone", { sender: window.webContents, senderFrame: null }],
  ];
  for (const [what, event] of untrusted)
    await assert.rejects(send(event, "openReference", "tmdb"), /Untrusted request/, what);
  // The main frame navigated away from the interface.
  mainFrame.url = "https://example.com/";
  await assert.rejects(send({ sender: window.webContents, senderFrame: mainFrame }, "openReference", "tmdb"), /Untrusted/);
  mainFrame.url = UI_URL;
  // No window: a request still in flight when it closed.
  closeWindow();
  await assert.rejects(send({ sender: window.webContents, senderFrame: mainFrame }, "openReference", "tmdb"), /Untrusted/);
  assert.deepEqual(opened, []);
  assert.match(await logged(), /openReference[\s\S]*Untrusted request/);
});

test("a request from the interface is handled", async (t) => {
  const { call, opened, shown } = await setup(t);
  await call("openReference", "tmdb");
  assert.deepEqual(opened, ["https://www.themoviedb.org"]);
  await call("showLog");
  assert.equal(shown.length, 1);
});

test("only listed references and source pages are opened", async (t) => {
  const { call, opened } = await setup(t);
  await assert.rejects(call("openReference", "toString"), /Unknown reference/);
  await assert.rejects(call("openReference", "https://example.com"), /Unknown reference/);
  await assert.rejects(call("openSourcePage", "https://example.com/"), /cannot be opened/);
  assert.deepEqual(opened, []);
});

test("dropped paths must be a short list of absolute paths", async (t) => {
  const { call, userData, session } = await setup(t);
  for (const paths of ["/a/file.mkv", ["relative/file.mkv"], [42], Array(2001).fill("/a.mkv")])
    await assert.rejects(call("addPaths", paths), /could not be added/);
  await fs.writeFile(path.join(userData, "Arrival.2016.mkv"), "");
  await call("addPaths", [path.join(userData, "Arrival.2016.mkv")]);
  assert.equal(session.state().groups.length, 1);
});

test("load says a settings notice once, and the version", async (t) => {
  const { call } = await setup(t, { notice: "Your saved settings could not be read." });
  const first = (await call("load")) as { notice?: string; about: { version: string } };
  assert.equal(first.notice, "Your saved settings could not be read.");
  assert.equal(first.about.version, "0.1.0");
  const second = (await call("load")) as { notice?: string };
  assert.equal(second.notice, undefined);
});

test("saved settings are written, merged with what was there, and passed on", async (t) => {
  const { call, userData, animeMap } = await setup(t);
  const saved = (await call("saveSettings", { animeSeasons: !DEFAULT_SETTINGS.animeSeasons })) as typeof DEFAULT_SETTINGS;
  assert.equal(saved.animeSeasons, !DEFAULT_SETTINGS.animeSeasons);
  assert.equal(animeMap.enabled, saved.animeSeasons);
  const written = JSON.parse(await fs.readFile(path.join(userData, SETTINGS_FILE), "utf8"));
  assert.deepEqual(written, saved);
  const loaded = (await call("load")) as { settings: typeof DEFAULT_SETTINGS };
  assert.deepEqual(loaded.settings, saved);
});

test("a token is never written without a keychain", async (t) => {
  const { call, exists, providers } = await setup(t, { keychain: fakeKeychain({ available: false }) });
  const sources = await call("setToken", "abc123");
  assert.deepEqual(sources, { tmdb: "session", tvdb: "none", canSave: false });
  assert.equal(providers.hasToken, true);
  assert.equal(await exists(TOKEN_FILE), false);
});

test("a token or key given through the window is hidden from the log", async (t) => {
  const { call, log, logged } = await setup(t);
  await call("setToken", "abc123");
  await assert.rejects(call("setTvdbKey", "offline", "9876"), /Could not reach TVDB/);
  // Something later fails with the values in its message.
  log.error("Lookup", new Error("abc123 and offline and 9876 were in a message"));
  const text = await logged();
  assert.match(text, /were in a message/);
  assert.doesNotMatch(text, /abc123|offline|9876/);
});

test("a TVDB key that TVDB refuses is not kept", async (t) => {
  const { call, exists, providers } = await setup(t);
  const result = (await call("setTvdbKey", "wrong", "")) as { refused?: string; sources: { tvdb: string } };
  assert.match(result.refused ?? "", /TVDB rejected that key/);
  assert.equal(result.sources.tvdb, "none");
  assert.equal(providers.hasTvdbKey, false);
  assert.equal(await exists(TVDB_FILE), false);
  const kept = (await call("setTvdbKey", "good", "")) as { sources: { tvdb: string } };
  assert.equal(kept.sources.tvdb, "saved");
  assert.equal(await exists(TVDB_FILE), true);
});

test("a picked folder is added and remembered for the next picker", async (t) => {
  const { call, userData, answers, pickers, session } = await setup(t);
  const media = path.join(userData, "media");
  await fs.mkdir(media);
  await fs.writeFile(path.join(media, "Arrival.2016.mkv"), "");
  answers.openDialog = { canceled: false, filePaths: [media] };
  await call("addFolder");
  assert.equal(session.state().groups.length, 1);
  assert.equal((await fs.readFile(path.join(userData, LAST_FOLDER_FILE), "utf8")), userData);
  answers.openDialog = { canceled: true, filePaths: [] };
  await call("addFiles");
  assert.equal(pickers[1]!.defaultPath, userData);
  assert.deepEqual(pickers[1]!.properties, ["openFile", "multiSelections"]);
});

test("apply needs the preview it was shown, and removing a batch asks first", async (t) => {
  const { call, answers, boxes, exists } = await setup(t);
  await assert.rejects(call("apply", "no-such-preview"), /Open Preview again/);
  assert.equal(boxes.length, 0);
  answers.messageBox = 0;
  assert.deepEqual(await call("removeBatch", "anything"), { canceled: true });
  assert.equal(boxes.at(-1)!.buttons!.at(-1), "Remove from History");
  assert.equal(await exists("history"), false);
});

test("a batch cannot be removed from History while another is running", async (t) => {
  const { call, guard, boxes } = await setup(t);
  let finish = () => {};
  const running = guard.run("apply", () => new Promise<void>((resolve) => (finish = resolve)));
  await assert.rejects(call("removeBatch", "anything"), /A batch is running/);
  assert.equal(boxes.length, 0);
  finish();
  await running;
});

test("a second batch is refused while one runs", async (t) => {
  const { call, guard } = await setup(t);
  let finish = () => {};
  const running = guard.run("apply", () => new Promise<void>((resolve) => (finish = resolve)));
  await assert.rejects(call("undo", "anything"), /already running/);
  await assert.rejects(call("apply", "anything"), /already running/);
  finish();
  await running;
});

test("an argument of the wrong type is refused before it is used", async (t) => {
  const { call, session, logged } = await setup(t);
  // Every request whose signature says text refuses anything else, rather than passing it on.
  const refusals: [string, unknown[]][] = [
    ["search", [{}, { title: "Solaris" }]],
    ["choose", [null, 0]],
    ["confirm", [{}]],
    ["remove", [7]],
    ["include", [{}]],
    ["exclude", [7, true]],
    ["setNumbering", [{}, "tvdb"]],
    ["setOrdering", [{}, null, false]],
    ["setEpisode", [{}, { episode: 1 }]],
    ["resetDestination", [{}]],
    ["chooseDestination", [{}]],
    ["batch", [{}]],
    ["apply", [{}]],
    ["setToken", [{}]],
    ["setTvdbKey", [{}, ""]],
    ["openSourcePage", [{}]],
    ["moveFiles", [[{}], null]],
    ["moveFiles", ["not a list", null]],
  ];
  for (const [name, args] of refusals)
    await assert.rejects(() => call(name, ...args), /could not be read|could not be moved/, name);
  // The queue is untouched and each refusal was logged.
  assert.deepEqual(session.state().groups, []);
  const log = await logged();
  for (const [name] of refusals) assert.match(log, new RegExp(name));
});
