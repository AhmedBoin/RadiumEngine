// scripts/clean.mjs — remove every build output.
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "packages/core/dist",
  "packages/react/dist",
  "packages/tauri/target",
  "apps/playground/dist",
  "templates/starter/dist",
];

for (const target of targets) {
  const path = join(root, target);
  if (!existsSync(path)) continue;
  rmSync(path, { recursive: true, force: true });
  console.log(`[clean] ${target}`);
}
console.log("[clean] done");
