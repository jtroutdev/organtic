import * as fs from "node:fs/promises";
import path from "node:path";
import { TvdbKeyRefused } from "../core/providers.ts";
import type { Providers } from "../core/providers.ts";
import type { SourcesState } from "../core/types.ts";

/** The part of Electron's `safeStorage` the keys use. */
export type Keychain = {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(text: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

/** The file names the keys are kept under, in the user data folder. */
export const TOKEN_FILE = "tmdb-token";
export const TVDB_FILE = "tvdb-key";

/**
 * The TMDB token and the TVDB key: given to the providers, and saved encrypted by the system
 * keychain when there is one. Without a real keychain they are held until the app quits and
 * never written. A TVDB key that TVDB refuses is not kept at all. Every value is handed to
 * `secret` first, so the log never shows it. Electron is kept out so this can be tested on its own.
 */
export class Keys {
  /** Whether keys can be saved. Linux without a keyring falls back to a fixed key, which protects nothing. */
  readonly canSave: boolean;
  #keychain: Keychain;
  #providers: Providers;
  #secret: (value: string) => void;
  #tokenFile: string;
  #tvdbFile: string;
  #tokenSaved = false;
  #tvdbSaved = false;

  constructor(options: {
    keychain: Keychain;
    platform: NodeJS.Platform;
    /** The user data folder. */
    folder: string;
    providers: Providers;
    secret: (value: string) => void;
  }) {
    this.#keychain = options.keychain;
    this.#providers = options.providers;
    this.#secret = options.secret;
    this.#tokenFile = path.join(options.folder, TOKEN_FILE);
    this.#tvdbFile = path.join(options.folder, TVDB_FILE);
    this.canSave =
      options.keychain.isEncryptionAvailable() &&
      (options.platform !== "linux" ||
        options.keychain.getSelectedStorageBackend() !== "basic_text");
  }

  /** Reads the saved keys, if any. One this keychain can no longer read is passed over. */
  async load() {
    if (!this.canSave) return;
    try {
      const token = this.#keychain.decryptString(await fs.readFile(this.#tokenFile));
      this.#secret(token);
      this.#providers.setToken(token);
      this.#tokenSaved = this.#providers.hasToken;
    } catch {
      // No saved token, or one this keychain can no longer read.
    }
    try {
      const [key = "", pin = ""] = this.#keychain
        .decryptString(await fs.readFile(this.#tvdbFile))
        .split("\n");
      this.#secret(key);
      this.#secret(pin);
      this.#providers.setTvdbKey(key, pin);
      this.#tvdbSaved = this.#providers.hasTvdbKey;
    } catch {
      // No saved key, or one this keychain can no longer read.
    }
  }

  sources(): SourcesState {
    const providers = this.#providers;
    return {
      tmdb: !providers.hasToken ? "none" : this.#tokenSaved ? "saved" : "session",
      tvdb: !providers.hasTvdbKey ? "none" : this.#tvdbSaved ? "saved" : "session",
      canSave: this.canSave,
    };
  }

  /** Sets the TMDB token, saving it when it can be. An empty token removes the saved one. */
  async setToken(token: unknown): Promise<SourcesState> {
    this.#secret(String(token));
    this.#providers.setToken(token);
    this.#tokenSaved = false;
    if (this.canSave && this.#providers.hasToken) {
      await this.#write(this.#tokenFile, String(token).trim());
      this.#tokenSaved = true;
    } else await fs.rm(this.#tokenFile, { force: true });
    return this.sources();
  }

  /**
   * Sets the TVDB key after signing in with it, saving it when it can be. A key TVDB refuses
   * is dropped and its refusal returned; an empty key removes the saved one.
   */
  async setTvdbKey(
    key: unknown,
    pin: unknown,
  ): Promise<{ sources: SourcesState; refused?: string }> {
    this.#secret(String(key));
    this.#secret(String(pin));
    this.#providers.setTvdbKey(key, pin);
    this.#tvdbSaved = false;
    if (!this.#providers.hasTvdbKey) {
      await fs.rm(this.#tvdbFile, { force: true });
      return { sources: this.sources() };
    }
    try {
      await this.#providers.checkTvdbKey();
    } catch (error) {
      // A key that does not work is not kept.
      this.#providers.setTvdbKey("");
      await fs.rm(this.#tvdbFile, { force: true });
      if (error instanceof TvdbKeyRefused)
        return { sources: this.sources(), refused: error.message };
      throw error;
    }
    if (this.canSave) {
      await this.#write(this.#tvdbFile, `${String(key).trim()}\n${String(pin).trim()}`);
      this.#tvdbSaved = true;
    }
    return { sources: this.sources() };
  }

  async #write(file: string, text: string) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, this.#keychain.encryptString(text), { mode: 0o600 });
  }
}
