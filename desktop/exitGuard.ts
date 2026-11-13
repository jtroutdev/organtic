/** A batch being applied, or one being undone. */
export type BatchKind = "apply" | "undo";
/** What the person chose when closing during a batch. */
export type ExitChoice = "keep" | "wait" | "stop";
/** Closing the window, or quitting the app. */
export type ExitKind = "close" | "quit";

type Running = { kind: BatchKind; controller: AbortController };

/**
 * Runs one file operation at a time and holds the app open while it runs. Closing or quitting
 * during a batch asks first: keep the app open, close when the batch finishes, or stop after
 * the operation in hand and then close. Electron is kept out so this can be tested on its own.
 */
export class ExitGuard {
  #ask: (kind: BatchKind) => Promise<ExitChoice>;
  #exit: (how: ExitKind) => void;
  #running: Running | undefined;
  #pending: ExitKind | undefined;
  #asking = false;

  constructor(options: {
    ask: (kind: BatchKind) => Promise<ExitChoice>;
    exit: (how: ExitKind) => void;
  }) {
    this.#ask = options.ask;
    this.#exit = options.exit;
  }

  get busy() {
    return this.#running !== undefined;
  }

  /** Runs `action` alone; its signal is aborted if the person chooses to stop. */
  async run<T>(kind: BatchKind, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#running)
      throw new Error("A file operation is already running. Wait for it to finish.");
    const running: Running = { kind, controller: new AbortController() };
    this.#running = running;
    try {
      return await action(running.controller.signal);
    } finally {
      this.#running = undefined;
      const how = this.#pending;
      this.#pending = undefined;
      if (how) this.#exit(how);
    }
  }

  /**
   * Called when the window is about to close or the app to quit. True when it may go ahead now;
   * false when a batch is running, in which case the person is asked and the exit, if they want
   * it, happens once the batch has ended.
   */
  request(how: ExitKind): boolean {
    if (!this.#running) return true;
    if (!this.#asking) void this.#decide(how, this.#running);
    return false;
  }

  async #decide(how: ExitKind, running: Running) {
    this.#asking = true;
    let choice: ExitChoice = "keep";
    try {
      choice = await this.#ask(running.kind);
    } catch {
      // A dialog that could not be shown keeps the app open.
    } finally {
      this.#asking = false;
    }
    if (choice === "keep") {
      this.#pending = undefined;
      return;
    }
    // Quitting asks for more than closing the window, so it wins.
    const exit = this.#pending === "quit" ? "quit" : how;
    // The batch ended while the question was open.
    if (!this.#running) return this.#exit(exit);
    this.#pending = exit;
    // Only the batch the question was about is stopped; one started since is waited for.
    if (choice === "stop" && this.#running === running) running.controller.abort();
  }
}
