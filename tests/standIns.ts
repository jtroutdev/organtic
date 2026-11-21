import type { Fetcher } from "../core/providers.ts";
import type { Keychain } from "../desktop/keys.ts";

/** Stand-ins for Electron and the network, shared by the desktop process's tests. */

/** A keychain that marks what it encrypts, so a test can tell a written key was encrypted. */
export function fakeKeychain(options: { available?: boolean; backend?: string } = {}): Keychain {
  return {
    isEncryptionAvailable: () => options.available ?? true,
    getSelectedStorageBackend: () => options.backend ?? "gnome_libsecret",
    encryptString: (text) => Buffer.from(`sealed:${Buffer.from(text).toString("base64")}`),
    decryptString: (sealed) => {
      const text = sealed.toString();
      if (!text.startsWith("sealed:")) throw new Error("Not sealed by this keychain.");
      return Buffer.from(text.slice("sealed:".length), "base64").toString();
    },
  };
}

/** TVDB's sign-in: 401 for the key "wrong", unreachable for "offline", a session otherwise. */
export const tvdbLogin: Fetcher = async (_url, init) => {
  const { apikey } = JSON.parse(init.body as string) as { apikey: string };
  if (apikey === "offline") throw new TypeError("fetch failed");
  if (apikey === "wrong") return Response.json({ status: "failure" }, { status: 401 });
  return Response.json({ data: { token: "session-token" } });
};
