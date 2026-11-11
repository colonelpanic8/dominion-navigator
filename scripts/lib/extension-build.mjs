import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const dist = resolve(root, "dist");
export const reportDir = resolve(root, "invariant-reports");

const entryPoints = [
  { source: "src/content-script.ts", output: "content-script.js" },
  { source: "src/page-probe.ts", output: "page-probe.js" }
];

export function esbuildConfigs(extra = {}) {
  return entryPoints.map(({ source, output }) => ({
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    logLevel: "info",
    ...extra,
    entryPoints: [resolve(root, source)],
    outfile: resolve(dist, output)
  }));
}

export async function cleanDist() {
  await rm(dist, { force: true, recursive: true });
  await mkdir(dist, { recursive: true });
}

export async function copyStatic() {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  await writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(resolve(root, "icons"), resolve(dist, "icons"), { recursive: true });
  await cp(resolve(root, "README.md"), resolve(dist, "README.md"));
  await mkdir(reportDir, { recursive: true });
  await rm(resolve(dist, "invariant-reports"), { force: true, recursive: true });
  await symlink("../invariant-reports", resolve(dist, "invariant-reports"), "dir");
}
