import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));
export default defineConfig({
  plugins: [vue()],
  // The browser preview's About shows the same version the desktop app reports.
  define: { __APP_VERSION__: JSON.stringify(version) },
  base: "./",
  server: { port: 47831, strictPort: true },
  preview: { host: "127.0.0.1", port: 47831, strictPort: true },
});
