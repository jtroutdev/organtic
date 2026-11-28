import * as fs from "node:fs/promises";
import path from "node:path";
import type {
  MessageBoxOptions,
  MessageBoxReturnValue,
  OpenDialogOptions,
  OpenDialogReturnValue,
} from "electron";
import { VIDEO_EXTENSIONS } from "../core/media.ts";
import { sourcePage } from "../core/providers.ts";
import {
  scanPaths,
  batchChanges,
  history,
  onSameDrive,
  removeBatch,
  undoBatch,
} from "../core/files.ts";
import type { HistoryCache } from "../core/files.ts";
import type { Session } from "../core/session.ts";
import { mergeSettings } from "../core/settings.ts";
import type { MediaApi } from "../core/api.ts";
import type { AppSettings } from "../core/types.ts";
import type { AppLog } from "./appLog.ts";
import type { BatchKind, ExitGuard } from "./exitGuard.ts";
import type { Keys } from "./keys.ts";
import { writeSettings } from "./settingsFile.ts";

/** The pages the window may ask to open in the browser, by name. */
export const REFERENCES: Record<string, string> = {
  tmdb: "https://www.themoviedb.org",
  token: "https://www.themoviedb.org/settings/api",
  tvmaze: "https://www.tvmaze.com",
  license: "https://creativecommons.org/licenses/by-sa/4.0/",
  tvdb: "https://thetvdb.com/api-information",
  tvdbHome: "https://thetvdb.com",
  kitsu: "https://kitsu.app",
};

/** Where a request came from, as Electron gives it to a handler. */
export type Sender = { sender: unknown; senderFrame: { url: string } | null };

/** The part of Electron's `ipcMain` the handlers use. */
export type Ipc = {
  handle(channel: string, listener: (event: Sender, ...args: unknown[]) => Promise<unknown>): void;
};

/** The window the interface runs in: requests are trusted only from its main frame. */
export type AppWindow = {
  webContents: { mainFrame: unknown; send(channel: string, payload: unknown): void };
};

/** Dialogs, already tied to the window. */
export type Dialogs = {
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
};

/** The part of Electron's `shell` the handlers use. */
export type Shell = {
  openExternal(url: string): Promise<void>;
  showItemInFolder(file: string): void;
};

export type HandlerOptions = {
  ipc: Ipc;
  dialogs: Dialogs;
  shell: Shell;
  /** The window, while it is open. */
  window: () => AppWindow | undefined;
  /** The interface's page; a request from any other page is refused. */
  uiUrl: string;
  /** The user data folder, where the settings and the last folder used are kept. */
  userData: string;
  journalDir: string;
  session: Session;
  keys: Keys;
  /** Told when the anime seasons setting changes. */
  animeMap: { enabled: boolean };
  log: AppLog;
  guard: ExitGuard;
  version: string;
  settings: AppSettings;
  /** Said once, on the first load: saved settings could not be read. */
  notice?: string;
};

// Handlers receive renderer input. Its types say nothing about what actually arrives, so each
// argument is checked here before it is passed on, and the session and core check their own
// invariants again: the browser preview drives the same core without this boundary.
type Handlers = {
  [K in Exclude<keyof MediaApi, "desktop" | "onQueue" | "onProgress" | "addDropped">]: MediaApi[K];
} & { addPaths(paths: string[]): Promise<void> };

/** The file the last folder used is kept in, in the user data folder. */
export const LAST_FOLDER_FILE = "last-folder";
export const SETTINGS_FILE = "settings.json";

/**
 * Registers every request the window can make, as `media:<name>`. Each one is refused unless it
 * comes from the window's main frame showing the interface's page, and a failure is logged
 * before it reaches the window. Electron is kept out, given as arguments, so this can be tested
 * with stand-ins.
 */
export async function registerHandlers(options: HandlerOptions): Promise<void> {
  const { ipc, dialogs, shell, uiUrl, userData, journalDir, session, keys, log, guard } = options;
  const settingsFile = path.join(userData, SETTINGS_FILE);
  let settings = options.settings;
  let notice = options.notice;

  const register = <K extends keyof Handlers>(name: K, handler: Handlers[K]) =>
    ipc.handle(`media:${name}`, async (event, ...args) => {
      try {
        const window = options.window();
        if (
          !window ||
          event.sender !== window.webContents ||
          !event.senderFrame ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== uiUrl
        )
          throw new Error("Untrusted request.");
        return await (handler as (...args: unknown[]) => unknown)(...args);
      } catch (error) {
        log.error(name, error);
        throw error;
      }
    });
  /** An argument the window said was text. Anything else is refused before it is used. */
  const text = (value: unknown, what: string): string => {
    if (typeof value !== "string") throw new Error(`That ${what} could not be read.`);
    return value;
  };
  const confirmDialog = async (title: string, message: string, detail: string, action: string) => {
    const response = await dialogs.showMessageBox({
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
  const lastFolderFile = path.join(userData, LAST_FOLDER_FILE);
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
    const result = await dialogs.showOpenDialog({
      title: folder ? "Add a media folder" : "Add media files",
      defaultPath: lastFolder,
      properties: folder ? ["openDirectory"] : ["openFile", "multiSelections"],
      ...(folder ? {} : { filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }] }),
    });
    if (result.canceled) return;
    if (result.filePaths[0]) await remember(result.filePaths[0]);
    await session.addFiles(await scanPaths(result.filePaths));
  }

  register("load", async () => {
    const shown = notice;
    // Said once: a reload of the window does not repeat it.
    notice = undefined;
    return {
      queue: session.state(),
      settings,
      sources: keys.sources(),
      about: { version: options.version, logFile: log.shown(log.file) },
      ...(shown ? { notice: shown } : {}),
    };
  });
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
  register("search", (key, request) => session.search(text(key, "group"), request));
  register("choose", (key, index) => session.choose(text(key, "group"), index));
  register("confirm", async (key) => session.confirm(text(key, "group")));
  register("confirmSuggested", async () => session.confirmSuggested());
  register("cancelLookups", async () => session.cancelLookups());
  register("remove", async (keys) => {
    if (Array.isArray(keys)) {
      if (keys.some((key) => typeof key !== "string"))
        throw new Error("Those groups could not be removed.");
      session.remove(keys);
    } else session.remove(text(keys, "group"));
  });
  register("clear", async () => session.clear());
  register("include", (fileId) => session.include(text(fileId, "file")));
  register("exclude", async (fileId, excluded) =>
    session.exclude(text(fileId, "file"), excluded === true),
  );
  register("moveFiles", (fileIds, targetKey) => {
    if (!Array.isArray(fileIds) || fileIds.some((id) => typeof id !== "string"))
      throw new Error("Those files could not be moved.");
    return session.moveFiles(fileIds, typeof targetKey === "string" ? targetKey : null);
  });
  register("setNumbering", (key, numbering) =>
    session.setNumbering(text(key, "group"), numbering === "tvdb" ? "tvdb" : "tmdb"),
  );
  register("setOrdering", (key, id, keepNumbers) =>
    session.setOrdering(
      text(key, "group"),
      typeof id === "string" ? id : null,
      keepNumbers === true,
    ),
  );
  register("setEpisode", (fileId, numbers) => session.setEpisode(text(fileId, "file"), numbers));
  register("chooseDestination", async (key) => {
    const wanted = text(key, "group");
    const group = session.state().groups.find((item) => item.key === wanted);
    if (!group) throw new Error("That group is no longer in the queue.");
    const result = await dialogs.showOpenDialog({
      title: "Organise inside this folder",
      defaultPath: lastFolder,
      properties: ["openDirectory", "createDirectory"],
    });
    const [folder] = result.filePaths;
    if (result.canceled || !folder) return;
    const chosen = await fs.realpath(folder);
    // Refused here, not when the batch is applied and some of it has already moved.
    if (!(await onSameDrive(chosen, group.files.map((file) => file.path))))
      throw new Error(
        `"${chosen}" is on a different drive from this group's files, and files are not moved between drives. Choose a folder on the same drive.`,
      );
    await remember(folder);
    session.setDestination(key, chosen);
  });
  register("resetDestination", async (key) => session.setDestination(text(key, "group"), null));
  register("preview", () => session.preview());
  /**
   * Reports a batch's progress to the window about ten times a second, and always its start
   * and its last operation, so the bar neither floods the bridge nor stops short.
   */
  const progressOf = (kind: BatchKind) => {
    let sent = 0;
    return (done: number, total: number) => {
      const now = Date.now();
      if (done !== 0 && done !== total && now - sent < 100) return;
      sent = now;
      options.window()?.webContents.send("media:progress", { kind, done, total });
    };
  };
  register("stop", async () => guard.stop());
  register("apply", (id) =>
    guard.run("apply", async (signal) => {
      const plan = session.pending(text(id, "preview"));
      if (!plan) throw new Error("The queue changed. Open Preview again first.");
      const confirmed = await confirmDialog(
        "Apply these changes?",
        `Apply ${plan.operations.length} file operations?`,
        "The batch is recorded in History so it can be undone. Existing files are never overwritten.",
        "Apply changes",
      );
      // Asked to stop while the confirmation was open.
      if (!confirmed || signal.aborted) return { canceled: true };
      return await session.apply(id, signal, progressOf("apply"));
    }),
  );
  // Records that have not changed since History last opened are not read again.
  const historyCache: HistoryCache = new Map();
  register("history", () => history(journalDir, historyCache));
  register("batch", (id) => batchChanges(text(id, "batch"), journalDir));
  register("removeBatch", async (id) => {
    if (guard.busy) throw new Error("A batch is running. Remove this one once it has finished.");
    const confirmed = await confirmDialog(
      "Remove this batch from History?",
      "Remove the record of this batch?",
      "It can no longer be undone from Organtic. No media file is moved or changed.",
      "Remove from History",
    );
    if (!confirmed) return { canceled: true };
    await removeBatch(text(id, "batch"), journalDir);
    return {};
  });
  register("undo", (id) =>
    guard.run("undo", async (signal) => {
      const batchId = text(id, "batch");
      const confirmed = await confirmDialog(
        "Undo this batch?",
        "Restore the original names and locations?",
        "Folders and metadata files the batch created are removed only if they are unchanged. Undo stops at any conflict.",
        "Undo batch",
      );
      if (!confirmed || signal.aborted) return { canceled: true };
      // Files still queued under a folder that got its old name back are followed there,
      // also when the undo stopped part-way.
      try {
        const { renamed } = await undoBatch(batchId, journalDir, undefined, signal, progressOf("undo"));
        if (renamed.length) session.relocate(renamed);
      } catch (error) {
        const partial = (error as { renamed?: unknown } | null)?.renamed;
        if (Array.isArray(partial) && partial.length) session.relocate(partial);
        throw error;
      }
      return {};
    }),
  );
  register("saveSettings", async (input) => {
    settings = mergeSettings(input, settings);
    await writeSettings(settingsFile, settings);
    options.animeMap.enabled = settings.animeSeasons;
    session.updateSettings(settings);
    return settings;
  });
  register("setToken", async (token) => {
    const sources = await keys.setToken(text(token, "token"));
    // Groups that could not be looked up without a token get another try.
    if (sources.tmdb !== "none") void session.retryUnmatched();
    return sources;
  });
  register("setTvdbKey", (key, pin) => keys.setTvdbKey(text(key, "key"), text(pin, "PIN")));
  register("openReference", async (key) => {
    const url = Object.hasOwn(REFERENCES, key) ? REFERENCES[key] : undefined;
    if (!url) throw new Error("Unknown reference.");
    await shell.openExternal(url);
  });
  register("showLog", async () => {
    // Before anything has gone wrong there is no file to point at, so start one.
    log.info("Log shown from Settings");
    shell.showItemInFolder(log.file);
  });
  register("openSourcePage", async (address) => {
    const url = sourcePage(text(address, "address"));
    if (!url) throw new Error("That page cannot be opened.");
    await shell.openExternal(url);
  });
}
