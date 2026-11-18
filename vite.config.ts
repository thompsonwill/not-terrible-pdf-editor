import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  optimizeDeps: { exclude: ["mupdf"] },
  worker: { format: "es" },
  build: { target: "esnext" },
  server: { port: 5199 },
  preview: { port: 5199 },
  test: { environment: "node", testTimeout: 30000 },
} as any);
