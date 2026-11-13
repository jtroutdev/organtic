/// <reference types="vite/client" />
import type { MediaApi } from "../core/api.ts";

declare global {
  /** The version in package.json, set by Vite. */
  const __APP_VERSION__: string;
  interface Window {
    /** Present only in the desktop app; see desktop/preload.cjs. */
    organtic?: MediaApi;
  }
}

