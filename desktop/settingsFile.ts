import * as fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS, mergeSettings } from "../core/settings.ts";
import type { AppSettings } from "../core/types.ts";

/** Where a settings file that could not be read is kept, beside the settings file. */
export const UNREADABLE_NAME = "settings-unreadable.json";

export type ReadSettings = {
  settings: AppSettings;
  /** Why saved settings could not be read; the defaults are in use. Absent when none were saved. */
  problem?: Error;
  /** The unusable file was moved aside as `settings-unreadable.json`. */
  kept?: boolean;
};

/**
 * Reads saved settings. A missing file means the defaults, quietly. A file that cannot be read
 * or used also means the defaults, but says so, and is moved aside as `settings-unreadable.json`
 * so the next save does not destroy what it held, such as a custom naming template.
 */
export async function readSettings(file: string): Promise<ReadSettings> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { settings: DEFAULT_SETTINGS };
    return { settings: DEFAULT_SETTINGS, problem: asError(error) };
  }
  try {
    return { settings: mergeSettings(JSON.parse(text)) };
  } catch (error) {
    try {
      await fs.rename(file, path.join(path.dirname(file), UNREADABLE_NAME));
      return { settings: DEFAULT_SETTINGS, problem: asError(error), kept: true };
    } catch {
      // Left where it is; the next save replaces it.
      return { settings: DEFAULT_SETTINGS, problem: asError(error) };
    }
  }
}

/**
 * Saves settings so a crash part-way leaves the old file or the new one, never half of either:
 * written in full to a temporary file beside it, flushed, then renamed over it.
 */
export async function writeSettings(file: string, settings: AppSettings) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = await fs.open(temporary, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(settings, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));
