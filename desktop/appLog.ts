import * as fs from "node:fs";
import path from "node:path";

export type LogOptions = {
  /** The log file. When it would pass `maxBytes`, it becomes `<file>.1` and a new one starts. */
  file: string;
  /** The home folder, written as `~` wherever it appears. */
  home: string;
  maxBytes?: number;
  now?: () => Date;
};

/** The longest single entry kept; anything longer is cut, so one error cannot fill the log. */
const MAX_ENTRY = 8_000;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A small log for bug reports: start-up, the version and system, and each failure's message
 * and stack. It holds no file listing, batch or lookup, the home folder is written as `~`, and
 * any token or key the app has been given is hidden. Writing is synchronous so an entry made
 * just before the process dies is not lost, and a log that cannot be written is ignored.
 * Electron is kept out so this can be tested on its own.
 */
export class AppLog {
  readonly file: string;
  #home: RegExp | undefined;
  #maxBytes: number;
  #now: () => Date;
  #secrets = new Set<string>();

  constructor({ file, home, maxBytes = 256 * 1024, now = () => new Date() }: LogOptions) {
    this.file = file;
    this.#maxBytes = maxBytes;
    this.#now = now;
    const trimmed = home.replace(/[\\/]+$/, "");
    // A bare root would turn every path into `~`, which hides nothing and helps no one.
    if (trimmed && trimmed !== path.parse(trimmed).root.replace(/[\\/]+$/, ""))
      this.#home = new RegExp(
        `${escape(trimmed)}(?=[\\\\/]|$|[^\\w.-])`,
        process.platform === "win32" ? "gi" : "g",
      );
  }

  /** A token or key in use, never to be written. An empty value is ignored. */
  secret(value: string) {
    const trimmed = value.trim();
    if (trimmed.length >= 4) this.#secrets.add(trimmed);
  }

  /** The log file's path as the log itself writes it, with the home folder as `~`. */
  shown(text: string) {
    let result = text;
    for (const secret of this.#secrets) result = result.split(secret).join("[hidden]");
    return this.#home ? result.replace(this.#home, "~") : result;
  }

  info(message: string) {
    this.#write("INFO", message);
  }

  /** Records a failure: where it happened, its message and its stack. */
  error(where: string, error: unknown) {
    const detail =
      error instanceof Error
        ? (error.stack ?? `${error.name}: ${error.message}`)
        : String(error);
    this.#write("ERROR", `${where}: ${detail}`);
  }

  #write(level: string, message: string) {
    let text = this.shown(message);
    if (text.length > MAX_ENTRY) text = `${text.slice(0, MAX_ENTRY)} [cut]`;
    const entry = `${this.#now().toISOString()} ${level} ${text.replace(/\r?\n/g, "\n  ")}\n`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      let size = 0;
      try {
        size = fs.statSync(this.file).size;
      } catch {
        // No log yet.
      }
      if (size > 0 && size + Buffer.byteLength(entry) > this.#maxBytes)
        fs.renameSync(this.file, `${this.file}.1`);
      fs.appendFileSync(this.file, entry, { mode: 0o600 });
    } catch {
      // A log that cannot be written must not become a failure of its own.
    }
  }
}
