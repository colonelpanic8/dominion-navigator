import { watchFile } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const autoReload = !process.argv.includes("--no-auto-reload");
let reloadTimer;
let reloading = false;
let pendingReload = false;

async function copyStatic() {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  await writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(resolve(root, "icons"), resolve(dist, "icons"), { recursive: true });
  await cp(resolve(root, "README.md"), resolve(dist, "README.md"));
}

function scheduleReload() {
  if (!autoReload) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reload, 200);
}

async function reload() {
  if (reloading) {
    pendingReload = true;
    return;
  }
  reloading = true;
  try {
    await copyStatic();
    const child = spawn(process.execPath, [resolve(root, "scripts/reload-extension.mjs")], {
      cwd: root,
      stdio: "inherit",
      env: process.env
    });
    const code = await new Promise((resolvePromise) => child.on("exit", resolvePromise));
    if (code !== 0) {
      console.warn(
        "Built extension, but automatic Chrome reload failed. " +
          "Run `npm run launch:chrome` for auto-reload, or reload the unpacked extension manually in chrome://extensions."
      );
    }
  } finally {
    reloading = false;
    if (pendingReload) {
      pendingReload = false;
      scheduleReload();
    }
  }
}

function reloadPlugin() {
  return {
    name: "reload-extension",
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length === 0) scheduleReload();
      });
    }
  };
}

await rm(dist, { force: true, recursive: true });
await mkdir(dist, { recursive: true });
await copyStatic();

const common = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
  plugins: [reloadPlugin()]
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: [resolve(root, "src/content-script.ts")],
    outfile: resolve(dist, "content-script.js")
  }),
  esbuild.context({
    ...common,
    entryPoints: [resolve(root, "src/page-probe.ts")],
    outfile: resolve(dist, "page-probe.js")
  })
]);

for (const context of contexts) await context.watch();

for (const file of [resolve(root, "manifest.json"), resolve(root, "README.md")]) {
  watchFile(file, { interval: 300 }, scheduleReload);
}

if (autoReload) {
  console.log("Watching extension sources and reloading Chrome. Press Ctrl-C to stop.");
} else {
  console.log("Watching extension sources without Chrome auto-reload. Press Ctrl-C to stop.");
}
