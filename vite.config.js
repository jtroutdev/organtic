import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  base: "./",
  server: { port: 47831, strictPort: true },
  preview: { host: "127.0.0.1", port: 47831, strictPort: true },
});
