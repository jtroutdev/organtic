import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  safeStorage,
  shell,
} from "electron";
import * as fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { VIDEO_EXTENSIONS } from "../core/media.ts";
import { AnimeMap } from "../core/animeMap.ts";
import { Providers } from "../core/providers.ts";
import {
  scanPaths,
  createPlan,
  applyPlan,
  history,
  undoBatch,
} from "../core/files.ts";
import { Session } from "../core/session.ts";
import { DEFAULT_SETTINGS, mergeSettings } from "../core/settings.ts";
import type { MediaApi } from "../core/api.ts";
import type { SourcesState } from "../core/types.ts";

// Compiled to build/desktop/, so project files are two levels up.
const root = path.join(import.meta.dirname, "../..");
const REFERENCES: Record<string, string> = {
  tmdb: "https://www.themoviedb.org",
  token: "https://www.themoviedb.org/settings/api",
  tvmaze: "https://www.tvmaze.com",
  license: "https://creativecommons.org/licenses/by-sa/4.0/",
  tvdb: "https://thetvdb.com/api-information",
};

let mainWindow: BrowserWindow | undefined;
let mutationBusy = false;
async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (mutationBusy)
    throw new Error(
      "A file operation is already running. Wait for it to finish.",
    );
  mutationBusy = true;
  try {
    return await action();
  } finally {
    mutationBusy = false;
  }
}

async function start() {
  const userData = app.getPath("userData");
  const journalDir = path.join(userData, "history");
  const settingsFile = path.join(userData, "settings.json");
  const tokenFile = path.join(userData, "tmdb-token");
  const uiUrl = pathToFileURL(path.join(root, "dist/index.html")).href;

  let settings = DEFAULT_SETTINGS;
  try {
    settings = mergeSettings(
      JSON.parse(await fs.readFile(settingsFile, "utf8")),
    );
  } catch {
    // Missing or unusable settings fall back to the defaults.
  }

  // Linux without a keyring falls back to a fixed key, which protects nothing.
  const canSave =
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" ||
      safeStorage.getSelectedStorageBackend() !== "basic_text");
  const animeMapFile = path.join(userData, "anime-index-2.json");
  const animeMap = new AnimeMap({
    cache: {
      read: async () => ({
        savedAt: (await fs.stat(animeMapFile)).mtimeMs,
        text: await fs.readFile(animeMapFile, "utf8"),
      }),
      write: async (text) => {
        await fs.mkdir(userData, { recursive: true });
        await fs.writeFile(animeMapFile, text);
      },
    },
  });
  animeMap.enabled = settings.animeSeasons;
  const providers = new Providers({ animeMap });
  let tokenSaved = false;
  if (canSave)
    try {
      providers.setToken(
        safeStorage.decryptString(await fs.readFile(tokenFile)),
      );
      tokenSaved = providers.hasToken;
    } catch {
      // No saved token, or one this keychain can no longer read.
    }
  const tvdbFile = path.join(userData, "tvdb-key");
  let tvdbSaved = false;
  if (canSave)
    try {
      const [key = "", pin = ""] = safeStorage
        .decryptString(await fs.readFile(tvdbFile))
        .split("\n");
      providers.setTvdbKey(key, pin);
      tvdbSaved = providers.hasTvdbKey;
    } catch {
      // No saved key, or one this keychain can no longer read.
    }
  const sources = (): SourcesState => ({
    tmdb: !providers.hasToken ? "none" : tokenSaved ? "saved" : "session",
    tvdb: !providers.hasTvdbKey ? "none" : tvdbSaved ? "saved" : "session",
    canSave,
  });

  const session = new Session({
    providers,
    settings,
    planner: { createPlan, applyPlan: (plan) => applyPlan(plan, journalDir) },
    onChange: (queue) => mainWindow?.webContents.send("media:queue", queue),
  });

  // Handlers receive renderer input; the session and core validate what they are given.
  type Handlers = {
    [K in Exclude<
      keyof MediaApi,
      "desktop" | "onQueue" | "addDropped"
    >]: MediaApi[K];
  } & { addPaths(paths: string[]): Promise<void> };
  const register = <K extends keyof Handlers>(name: K, handler: Handlers[K]) =>
    ipcMain.handle(`media:${name}`, (event, ...args: unknown[]) => {
      if (
        !mainWindow ||
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame ||
        event.senderFrame.url !== uiUrl
      )
        throw new Error("Untrusted request.");
      return (handler as (...args: unknown[]) => unknown)(...args);
    });
  const confirmDialog = async (
    title: string,
    message: string,
    detail: string,
    action: string,
  ) => {
    const response = await dialog.showMessageBox(mainWindow!, {
      type: "question",
      title,
      message,
      detail,
      buttons: ["Cancel", action],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return response.response === 1;
  };
  // The file browser reopens where it was last used: beside the folder picked, or in the folder
  // the files were picked from.
  const lastFolderFile = path.join(userData, "last-folder");
  let lastFolder: string | undefined;
  try {
    lastFolder = (await fs.readFile(lastFolderFile, "utf8")).trim() || undefined;
  } catch {
    // Nothing remembered yet.
  }
  async function remember(picked: string) {
    lastFolder = path.dirname(picked);
    try {
      await fs.mkdir(userData, { recursive: true });
      await fs.writeFile(lastFolderFile, lastFolder);
    } catch {
      // Still remembered until the app closes.
    }
  }
  async function pick(folder: boolean) {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: folder ? "Add a media folder" : "Add media files",
      defaultPath: lastFolder,
      properties: folder ? ["openDirectory"] : ["openFile", "multiSelections"],
      ...(folder
        ? {}
        : { filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }] }),
    });
    if (result.canceled) return;
    if (result.filePaths[0]) await remember(result.filePaths[0]);
    await session.addFiles(await scanPaths(result.filePaths));
  }

  register("load", async () => ({
    queue: session.state(),
    settings,
    sources: sources(),
  }));
  register("addFiles", () => pick(false));
  register("addFolder", () => pick(true));
  register("addPaths", async (paths) => {
    if (
      !Array.isArray(paths) ||
      paths.length > 2000 ||
      paths.some((item) => typeof item !== "string" || !path.isAbsolute(item))
    )
      throw new Error("Those files could not be added.");
    await session.addFiles(await scanPaths(paths));
  });
  register("search", (key, request) => session.search(key, request));
  register("choose", (key, index) => session.choose(key, index));
  register("confirm", async (key) => session.confirm(key));
  register("confirmSuggested", async () => session.confirmSuggested());
  register("cancelLookups", async () => session.cancelLookups());
  register("remove", async (key) => session.remove(key));
  register("clear", async () => session.clear());
  register("include", (fileId) => session.include(fileId));
  register("exclude", async (fileId, excluded) =>
    session.exclude(fileId, excluded === true),
  );
  register("moveFiles", (fileIds, targetKey) =>
    session.moveFiles(fileIds, typeof targetKey === "string" ? targetKey : null),
  );
  register("setNumbering", (key, numbering) =>
    session.setNumbering(key, numbering === "tvdb" ? "tvdb" : "tmdb"),
  );
  register("setOrdering", (key, id, keepNumbers) =>
    session.setOrdering(
      key,
      typeof id === "string" ? id : null,
      keepNumbers === true,
    ),
  );
  register("setEpisode", (fileId, numbers) =>
    session.setEpisode(fileId, numbers),
  );
  register("chooseDestination", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Organise inside this folder",
      defaultPath: lastFolder,
      properties: ["openDirectory", "createDirectory"],
    });
    const [folder] = result.filePaths;
    if (result.canceled || !folder) return;
    await remember(folder);
    session.setDestination(await fs.realpath(folder));
  });
  register("resetDestination", async () => session.setDestination(null));
  register("preview", () => session.preview());
  register("apply", (id) =>
    exclusive(async () => {
      const plan = session.pending(id);
      if (!plan)
        throw new Error("The queue changed. Open Preview again first.");
      const confirmed = await confirmDialog(
        "Apply these changes?",
        `Apply ${plan.operations.length} file operations?`,
        "The batch is recorded in History so it can be undone. Existing files are never overwritten.",
        "Apply changes",
      );
      if (!confirmed) return { canceled: true };
      return await session.apply(id);
    }),
  );
  register("history", () => history(journalDir));
  register("undo", (id) =>
    exclusive(async () => {
      const confirmed = await confirmDialog(
        "Undo this batch?",
        "Restore the original names and locations?",
        "Folders and metadata files the batch created are removed only if they are unchanged. Undo stops at any conflict.",
        "Undo batch",
      );
      if (!confirmed) return { canceled: true };
      const { renamed } = await undoBatch(id, journalDir);
      // Files still queued under a folder that got its old name back are followed there.
      if (renamed.length) session.relocate(renamed);
      return {};
    }),
  );
  register("saveSettings", async (input) => {
    settings = mergeSettings(input, settings);
    await fs.mkdir(userData, { recursive: true });
    await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
    animeMap.enabled = settings.animeSeasons;
    session.updateSettings(settings);
    return settings;
  });
  register("setToken", async (token) => {
    providers.setToken(token);
    tokenSaved = false;
    if (canSave && providers.hasToken) {
      await fs.mkdir(userData, { recursive: true });
      await fs.writeFile(
        tokenFile,
        safeStorage.encryptString(String(token).trim()),
        { mode: 0o600 },
      );
      tokenSaved = true;
    } else await fs.rm(tokenFile, { force: true });
    // Groups that could not be looked up without a token get another try.
    if (providers.hasToken) void session.retryUnmatched();
    return sources();
  });
  register("setTvdbKey", async (key, pin) => {
    providers.setTvdbKey(key, pin);
    tvdbSaved = false;
    if (!providers.hasTvdbKey) {
      await fs.rm(tvdbFile, { force: true });
      return sources();
    }
    try {
      await providers.checkTvdbKey();
    } catch (error) {
      // A key that does not work is not kept.
      providers.setTvdbKey("");
      await fs.rm(tvdbFile, { force: true });
      throw error;
    }
    if (canSave) {
      await fs.mkdir(userData, { recursive: true });
      await fs.writeFile(
        tvdbFile,
        safeStorage.encryptString(`${String(key).trim()}\n${String(pin).trim()}`),
        { mode: 0o600 },
      );
      tvdbSaved = true;
    }
    return sources();
  });
  register("openReference", async (key) => {
    const url = Object.hasOwn(REFERENCES, key) ? REFERENCES[key] : undefined;
    if (!url) throw new Error("Unknown reference.");
    await shell.openExternal(url);
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 840,
      minHeight: 650,
      backgroundColor: "#0c0d19",
      title: "Organtic",
      webPreferences: {
        // Sandboxed preload scripts must be CommonJS, so this one is not compiled.
        preload: path.join(root, "desktop/preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (event) =>
      event.preventDefault(),
    );
    mainWindow.webContents.session.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    mainWindow.loadURL(uiUrl);
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(start);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
