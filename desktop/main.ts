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
import { AnimeMap } from "../core/animeMap.ts";
import { Providers } from "../core/providers.ts";
import { createPlan, applyPlan, checkRoom } from "../core/files.ts";
import { Session } from "../core/session.ts";
import { AppLog } from "./appLog.ts";
import { ExitGuard } from "./exitGuard.ts";
import { registerHandlers, SETTINGS_FILE } from "./handlers.ts";
import { Keys } from "./keys.ts";
import { readSettings, UNREADABLE_NAME } from "./settingsFile.ts";
import type { BatchKind, ExitChoice } from "./exitGuard.ts";

// Compiled to build/desktop/, so project files are two levels up.
const root = path.join(import.meta.dirname, "../..");

let mainWindow: BrowserWindow | undefined;

// Problems are written here for bug reports; see AppLog for what it may hold.
const log = new AppLog({
  file: path.join(app.getPath("userData"), "logs", "organtic.log"),
  home: app.getPath("home"),
});
process.on("uncaughtExceptionMonitor", (error) => log.error("Uncaught", error));
process.on("unhandledRejection", (reason) => log.error("Unhandled", reason));

const EXIT_CHOICES: ExitChoice[] = ["keep", "wait", "stop"];
const EXIT_WORDING: Record<BatchKind, { message: string; detail: string }> = {
  apply: {
    message: "A batch is still renaming files.",
    detail:
      "Stopping finishes the file in hand and records where the batch stopped, so History can undo what was done.",
  },
  undo: {
    message: "A batch is still being undone.",
    detail:
      "Stopping finishes the file in hand. Undo the batch again from History to put back the rest.",
  },
};
// File operations run one at a time, and closing or quitting during one asks first.
const guard = new ExitGuard({
  ask: async (kind) => {
    const options = {
      type: "warning" as const,
      title: "Close Organtic?",
      ...EXIT_WORDING[kind],
      buttons: ["Keep open", "Close when finished", "Stop and close"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const { response } = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    return EXIT_CHOICES[response] ?? "keep";
  },
  exit: (how) => (how === "quit" || !mainWindow ? app.quit() : mainWindow.close()),
});

async function start() {
  const userData = app.getPath("userData");
  const journalDir = path.join(userData, "history");
  const settingsFile = path.join(userData, SETTINGS_FILE);
  const uiUrl = pathToFileURL(path.join(root, "dist/index.html")).href;

  log.info(
    `Organtic ${app.getVersion()} on ${process.platform} ${process.arch} ${process.getSystemVersion()}, Electron ${process.versions.electron}`,
  );
  const read = await readSettings(settingsFile);
  const settings = read.settings;
  let notice: string | undefined;
  if (read.problem) {
    log.error("Reading settings", read.problem);
    notice = read.kept
      ? `Your saved settings could not be read, so the defaults are in use. The old file is kept as ${UNREADABLE_NAME} in ${log.shown(userData)}.`
      : "Your saved settings could not be read, so the defaults are in use.";
  }

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
  const keys = new Keys({
    keychain: safeStorage,
    platform: process.platform,
    folder: userData,
    providers,
    secret: (value) => log.secret(value),
  });
  await keys.load();

  const session = new Session({
    providers,
    settings,
    planner: {
      // The preview also says when the batch has nowhere to go: a read-only or full disk.
      createPlan: async (selections, options) => {
        const plan = await createPlan(selections, options);
        if (plan.operations.length)
          for (const message of await checkRoom(plan, journalDir)) {
            plan.errors.push(message);
            plan.issues.push({ message });
          }
        return plan;
      },
      applyPlan: (plan, signal, onProgress) =>
        applyPlan(plan, journalDir, undefined, signal, onProgress),
    },
    onUpdate: (update) => mainWindow?.webContents.send("media:queue", update),
    // About a frame: a burst of lookups reaches the window as one update.
    defer: (flush) => setTimeout(flush, 16),
  });

  await registerHandlers({
    ipc: ipcMain,
    dialogs: {
      showMessageBox: (options) => dialog.showMessageBox(mainWindow!, options),
      showOpenDialog: (options) => dialog.showOpenDialog(mainWindow!, options),
    },
    shell,
    window: () => mainWindow,
    uiUrl,
    userData,
    journalDir,
    session,
    keys,
    animeMap,
    log,
    guard,
    version: app.getVersion(),
    settings,
    ...(notice ? { notice } : {}),
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      // Linux takes the window's icon from here; Windows and macOS use the packaged one.
      icon: path.join(root, "dist/icon.png"),
      width: 1280,
      height: 900,
      minWidth: 840,
      minHeight: 650,
      // --color-background in sRGB hex: this option does not take oklch.
      backgroundColor: "#0e0c19",
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
    // Without a View menu nothing opens devtools, so unpackaged runs get the
    // usual shortcut back.
    if (!app.isPackaged) {
      const { webContents } = mainWindow;
      webContents.on("before-input-event", (event, input) => {
        if (
          input.type === "keyDown" &&
          input.control &&
          input.shift &&
          input.key.toLowerCase() === "i"
        ) {
          event.preventDefault();
          webContents.toggleDevTools();
        }
      });
    }
    mainWindow.on("close", (event) => {
      if (!guard.request("close")) event.preventDefault();
    });
    mainWindow.on("closed", () => (mainWindow = undefined));
    mainWindow.loadURL(uiUrl).catch((error: unknown) => log.error("Loading the window", error));
  }
  // macOS keeps its menu: it sits in the system bar, not the window, and
  // copy, paste and quit stop working without it. Its View menu, with reload
  // and devtools, is for unpackaged runs only.
  Menu.setApplicationMenu(
    process.platform === "darwin"
      ? Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "editMenu" },
          ...(app.isPackaged ? [] : [{ role: "viewMenu" } as const]),
          { role: "windowMenu" },
        ])
      : null,
  );
  createWindow();
  app.on("before-quit", (event) => {
    if (!guard.request("quit")) event.preventDefault();
  });
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
else
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      log.error("Start-up", error);
      dialog.showErrorBox(
        "Organtic could not start",
        `${error instanceof Error ? error.message : String(error)}\n\nThe details are in ${log.shown(log.file)}.`,
      );
      app.exit(1);
    });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
