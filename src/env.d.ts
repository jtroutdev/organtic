/// <reference types="vite/client" />
import type { MediaApi } from "../core/api.ts";

declare global {
  interface Window {
    /** Present only in the desktop app; see desktop/preload.cjs. */
    organtic?: MediaApi;
  }
}
