/**
 * Starts the built desktop app once with a temporary profile and drives its window through
 * Chromium's remote debugging protocol: the preload bridge is there and Node is not, the window
 * loads, settings are saved and land on disk, then the window is closed and the app must quit
 * cleanly with nothing written to its log as an error. Run after `npm run build`.
 *
 * Linux only: the profile is moved by pointing XDG_CONFIG_HOME at a temporary folder, so the
 * person's own settings and keyring are never touched. CI runs it under xvfb.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const LIMIT = 60_000;

if (process.platform !== "linux") {
  console.error("The smoke test runs on Linux only.");
  process.exit(1);
}

const electron = createRequire(import.meta.url)("electron") as string;
const home = await fs.mkdtemp(path.join(os.tmpdir(), "organtic-smoke-"));
// Electron names the profile folder after package.json's "name".
const userData = path.join(home, "organtic");
let child: ReturnType<typeof spawn> | undefined;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(what: string, check: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + LIMIT;
  for (;;) {
    const found = await check().catch(() => undefined);
    if (found !== undefined) return found;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await wait(100);
  }
}

/** A connection to the page that sends one expression at a time and returns its value. */
async function connect(url: string) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let next = 0;
  const waiting = new Map<
    number,
    { resolve: (message: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    if (typeof message.id === "number") waiting.get(message.id)?.resolve(message);
  });
  // A page that closes leaves nothing to answer.
  socket.addEventListener("close", () => {
    for (const { reject } of waiting.values()) reject(new Error("The page closed."));
    waiting.clear();
  });
  return {
    async evaluate<T>(expression: string): Promise<T> {
      const id = ++next;
      const answer = new Promise<Record<string, unknown>>((resolve, reject) =>
        waiting.set(id, { resolve, reject }),
      );
      socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
      const { result, error } = (await answer) as {
        result?: { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string } } };
        error?: { message: string };
      };
      if (error) throw new Error(error.message);
      if (result?.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description ?? "The page threw.");
      return result?.result?.value as T;
    },
    close: () => socket.close(),
  };
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  const output: string[] = [];
  child = spawn(
    electron,
    [
      root,
      "--remote-debugging-port=0",
      "--password-store=basic",
      // Ubuntu's runners refuse the user namespaces Chromium's sandbox needs; elsewhere it stays on.
      ...(process.env.CI ? ["--no-sandbox"] : []),
    ],
    {
      env: { ...process.env, XDG_CONFIG_HOME: home, ELECTRON_ENABLE_LOGGING: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (data) => output.push(String(data)));
  child.stderr?.on("data", (data) => output.push(String(data)));
  const exited = new Promise<number | null>((resolve) => child!.on("exit", resolve));

  // Chromium writes the port it chose into the profile.
  const port = await until("the debugging port", async () =>
    (await fs.readFile(path.join(userData, "DevToolsActivePort"), "utf8")).split("\n")[0] || undefined,
  );
  const target = await until("the window", async () => {
    const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
      type: string;
      url: string;
      webSocketDebuggerUrl: string;
    }[];
    return list.find((item) => item.type === "page" && item.url.endsWith("/dist/index.html"));
  });
  const page = await connect(target.webSocketDebuggerUrl);
  await until("the page to load", async () =>
    (await page.evaluate<string>("document.readyState")) === "complete" ? true : undefined,
  );

  check(
    (await page.evaluate("typeof require")) === "undefined" &&
      (await page.evaluate("typeof process")) === "undefined",
    "The page can reach Node.",
  );
  check((await page.evaluate("window.organtic?.desktop")) === true, "The preload bridge is missing.");

  const loaded = await page.evaluate<{ settings: { animeSeasons: boolean }; sources: { tmdb: string } }>(
    "window.organtic.load()",
  );
  check(loaded.sources.tmdb === "none", "A token was found in a new profile.");
  const wanted = !loaded.settings.animeSeasons;
  const saved = await page.evaluate<{ animeSeasons: boolean }>(
    `window.organtic.saveSettings({ animeSeasons: ${wanted} })`,
  );
  check(saved.animeSeasons === wanted, "Saving settings did not take.");
  const written = JSON.parse(await fs.readFile(path.join(userData, "settings.json"), "utf8")) as {
    animeSeasons: boolean;
  };
  check(written.animeSeasons === wanted, "The saved settings are not on disk.");
  const preview = await page
    .evaluate("window.organtic.preview()")
    .then(() => "allowed", (error: Error) => error.message);
  check(preview !== "allowed", "Preview of an empty queue was not refused.");

  // Closing the only window quits the app on Linux.
  await page.evaluate("window.close()").catch(() => {});
  page.close();
  let timer: NodeJS.Timeout | undefined;
  const code = await Promise.race([
    exited,
    new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), LIMIT))),
  ]);
  clearTimeout(timer);
  check(code !== "timeout", "The app did not quit after its window closed.");
  check(code === 0, `The app exited with ${code}.\n${output.join("")}`);

  const log = await fs.readFile(path.join(userData, "logs", "organtic.log"), "utf8");
  // The refused preview is logged, as every failed request is; nothing else may be.
  const errors = log.split(/\n(?=\S)/).filter((entry) => / ERROR /.test(entry));
  check(
    errors.length === 1 && / ERROR preview: Error: Confirm at least one group/.test(errors[0]!),
    `The app logged an unexpected error:\n${log}`,
  );
  console.log("Smoke test passed: bridge, load, settings saved, empty preview refused, clean quit.");
} catch (error) {
  child?.kill();
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await fs.rm(home, { recursive: true, force: true });
}
