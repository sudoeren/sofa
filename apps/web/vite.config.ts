import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SERVER = "http://localhost:8787";

// Test settings live in vitest.config.ts: vitest ships its own vite, whose plugin types differ.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/collab": { target: SERVER, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
