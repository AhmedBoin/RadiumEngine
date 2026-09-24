import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Tauri serves the built app from ../dist, hence the fixed port and base. */
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5183, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2022", sourcemap: true, outDir: "dist" },
});
