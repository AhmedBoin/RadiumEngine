import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5199, open: false },
  build: { target: "es2022", sourcemap: true },
});
