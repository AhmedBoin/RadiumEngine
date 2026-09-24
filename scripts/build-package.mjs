// scripts/build-package.mjs — build one workspace package.
//
//   node scripts/build-package.mjs packages/core
//
// esbuild bundles the sources into a single ESM file per entry (`dist/index.js`),
// leaving framework dependencies external, and `tsc` emits the type declarations
// next to it. Bundling avoids the classic "extensionless ESM import" problem that
// makes a plain `tsc` output unusable in Node, without forcing ".js" suffixes in
// every source file.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const packageDir = resolve(root, process.argv[2] ?? "packages/core");

if (!existsSync(join(packageDir, "package.json"))) {
  console.error(`No package.json in ${packageDir}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));

/** Entries: the "." export, plus any subpath export (used for tree shaking). */
const entries = new Map();
entries.set(join(packageDir, "src", "index.ts"), join(packageDir, "dist", "index.js"));
for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
  if (subpath === ".") continue;
  const target = typeof value === "object" ? value.import ?? value.default : value;
  if (!target) continue;
  const source = join(packageDir, "src", subpath.replace(/^\.\//, ""), "index.ts");
  if (existsSync(source)) entries.set(source, resolve(packageDir, target));
}

/** Everything that must stay external: peers + node builtins + tauri plugins. */
const external = [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
  /* subpath imports of peers (e.g. "leaflet/dist/leaflet.css", "three/addons/…")
     must stay external too: a library never bundles another library's assets */
  "leaflet/*",
  "maplibre-gl/*",
  "three/*",
  "react/*",
  "react-dom/*",
  "geotiff/*",
  "@tauri-apps/*",
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
  "leaflet",
  "react-leaflet",
  "maplibre-gl",
  "three",
  "geotiff",
];

for (const [entryPoint, outfile] of entries) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "neutral",
    sourcemap: true,
    external,
    logLevel: "warning",
  });
  console.log(`[build] ${outfile.replace(root + "\\", "").replace(root + "/", "")}`);
}

/* declarations only: tsc still owns the .d.ts files. Running the compiler through
   `node` avoids the Windows ".cmd needs a shell" trap of spawning npx. */
const require = createRequire(import.meta.url);
const tscBin = require.resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tscBin, "-p", "tsconfig.build.json"], {
  cwd: packageDir,
  stdio: "inherit",
});
console.log(`[build] ${manifest.name} done`);
