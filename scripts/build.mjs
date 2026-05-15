import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const reportDir = resolve(root, "invariant-reports");

await rm(dist, { force: true, recursive: true });
await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  logLevel: "info"
};

await esbuild.build({
  ...common,
  entryPoints: [resolve(root, "src/content-script.ts")],
  outfile: resolve(dist, "content-script.js")
});

await esbuild.build({
  ...common,
  entryPoints: [resolve(root, "src/page-probe.ts")],
  outfile: resolve(dist, "page-probe.js")
});

const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
await writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(resolve(root, "icons"), resolve(dist, "icons"), { recursive: true });
await cp(resolve(root, "README.md"), resolve(dist, "README.md"));
await mkdir(reportDir, { recursive: true });
await symlink("../invariant-reports", resolve(dist, "invariant-reports"), "dir");
