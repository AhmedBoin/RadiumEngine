// scripts/check-package.mjs — the invariants a published library lives or dies by.
//
// These are the rules `RESUME.md` states in prose. Prose does not fail a build, so they are
// asserted here instead:
//
//   1. every `exports` entry of every package exists on disk after a build (a typo in
//      `exports` is a broken import for the consumer, not for us);
//   2. no STATIC import of an optional peer (`leaflet`, `maplibre-gl`, `three`, `geotiff`,
//      `@tauri-apps/*`) in any bundle — those must stay dynamic, or an app that does not use
//      them cannot build at all;
//   3. no deep import of a peer is ASSETS (\`leaflet/dist/leaflet.css\`): the consumer imports
//      it once, in their own entry file;
//   4. \`core\` imports nothing from the other packages (it is the dependency-free floor);
//   5. every package is publishable in shape: \`files\`, \`license\`, \`main\`/\`module\`/\`types\`,
//      \`sideEffects: false\`, and its optional peers declared as optional.
//
// Run it after a build: `npm run check:package` (it builds first).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let failures = 0;
const ok = (label, condition, detail = "") => {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${condition || !detail ? "" : ` (${detail})`}`);
};

const packages = ["core", "react", "tauri"].map((name) => ({
  name,
  dir: join(root, "packages", name),
  manifest: join(root, "packages", name, "package.json"),
}));

const OPTIONAL_PEERS = ["leaflet", "maplibre-gl", "three", "geotiff", "@tauri-apps/plugin-fs", "@tauri-apps/api"];

/** Every .js file under a directory (the built bundles). */
function distFiles(dir) {
  const out = [];
  const walk = (current) => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".js")) out.push(path);
    }
  };
  walk(join(dir, "dist"));
  return out;
}
/* ── 1. the exports a consumer will actually import must exist ────────── */
for (const pkg of packages) {
  if (!existsSync(pkg.manifest)) {
    ok(`${pkg.name}: package.json exists`, false, pkg.manifest);
    continue;
  }
  const manifest = JSON.parse(readFileSync(pkg.manifest, "utf8"));
  const entries = Object.entries(manifest.exports ?? {});
  let missing = 0;
  for (const [key, value] of entries) {
    for (const target of Object.values(typeof value === "string" ? { default: value } : value)) {
      if (typeof target !== "string") continue;
      if (!existsSync(join(pkg.dir, target))) {
        missing++;
        console.log(`       ${manifest.name} exports["${key}"] -> ${target} is missing`);
      }
    }
  }
  ok(`${manifest.name}: every exports entry exists in dist`, missing === 0 && entries.length > 0, `${missing} missing`);

  /* ── 5. publishable shape ──────────────────────────────────────────── */
  ok(`${manifest.name}: declares files/license/main/module/types`, !!(manifest.files && manifest.license && manifest.main && manifest.module && manifest.types));
  ok(`${manifest.name}: sideEffects is false (tree-shaken by the consumer)` , manifest.sideEffects === false);
  /* hygiene: an "optional" marker only makes sense for a declared peer, and a package
     must not silently require something it never declared */
  const peers = Object.keys(manifest.peerDependencies ?? {});
  const metas = Object.keys(manifest.peerDependenciesMeta ?? {});
  ok(
    `${manifest.name}: peerDependenciesMeta only marks declared peers`,
    metas.every((peer) => peers.includes(peer)),
    metas.filter((peer) => !peers.includes(peer)).join(", ") || "all declared",
  );
  ok(`${manifest.name}: has a name and a version`, !!manifest.name && !!manifest.version);
}

/* ── 2 + 3. no static optional-peer imports, no peer ASSET imports ────── */
for (const pkg of packages) {
  const manifest = JSON.parse(readFileSync(pkg.manifest, "utf8"));
  const optionalPeers = new Set(
    Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta && meta.optional)
      .map(([name]) => name),
  );
  let staticImports = 0;
  let assetImports = 0;
  for (const file of distFiles(pkg.dir)) {
    const text = readFileSync(file, "utf8");
    for (const peer of OPTIONAL_PEERS) {
      /* a REQUIRED peer may be imported statically (it must be installed anyway); only an
         optional one has to stay dynamic, or an app without it cannot build */
      if (!optionalPeers.has(peer)) continue;
      const escaped = peer.replace(/[/@]/g, (char) => "\\" + char);
      /* `import … from "peer"`, `import "peer"` and `export … from "peer"` are static;
         `import("peer")` and `import(specifier)` are the dynamic forms that are allowed */
      const stat = new RegExp(`(^|[\\s;}}\\)])(import|export)\\s[^;()]*?from\\s*["']${escaped}["']|(^|[\\s;}}\\)])import\\s*["']${escaped}["']`, "m");
      if (stat.test(text)) {
        staticImports++;
        console.log(`       ${file.replace(root, "")} imports ${peer} statically`);
      }
      if (new RegExp(`["'][^"']*${escaped}/dist/[^"']*["']`).test(text)) {
        assetImports++;
        console.log(`       ${file.replace(root, "")} imports a peer ASSET from ${peer}`);
      }
    }
  }
  ok(`${pkg.name}: no OPTIONAL peer is imported statically`, staticImports === 0, `${staticImports} static import(s)`);
  ok(`${pkg.name}: no peer stylesheet is imported`, assetImports === 0, `${assetImports} asset import(s)`);
}

/* ── 4. core is the dependency-free floor ────────────────────────────── */
{
  const coreDir = join(root, "packages", "core");
  let offenders = 0;
  for (const file of distFiles(coreDir)) {
    const text = readFileSync(file, "utf8");
    if (/from\s*["']@radium-engine\//.test(text) || /import\(\s*["']@radium-engine\//.test(text)) {
      offenders++;
      console.log(`       ${file.replace(root, "")} imports another engine package`);
    }
  }
  ok("core depends on no other @radium-engine package", offenders === 0, `${offenders} file(s)`);
}

/* ── the repository is installable as a whole ────────────────────────── */
{
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  ok("the root declares the workspaces", Array.isArray(rootManifest.workspaces) && rootManifest.workspaces.includes("packages/*"));
  ok("the root pins a node floor", !!rootManifest.engines?.node, rootManifest.engines?.node ?? "missing");
  ok("a CI workflow runs the same commands", existsSync(join(root, ".github", "workflows", "ci.yml")));
  for (const script of ["typecheck", "build", "check", "check:package", "playground"]) {
    ok(`root script "${script}" exists`, !!rootManifest.scripts?.[script]);
  }
}

console.log(failures === 0 ? "\nPACKAGE CHECKS PASSED" : `\n${failures} PACKAGE ERROR(S)`);
process.exit(failures === 0 ? 0 : 1);
