import { watchFile } from "node:fs";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const reportDir = resolve(root, "invariant-reports");
const autoReload = !process.argv.includes("--no-auto-reload");
const reportSinkPort = Number(process.env.DOMINION_NAVIGATOR_REPORT_SINK_PORT ?? "9237");
let reloadTimer;
let reloading = false;
let pendingReload = false;

function startReportSink() {
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  };

  const server = createServer((request, response) => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== "POST" || request.url !== "/invariant-report") {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found\n");
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) request.destroy();
    });
    request.on("end", async () => {
      try {
        const report = JSON.parse(body);
        const rawId = typeof report.id === "string" ? report.id : new Date().toISOString();
        const rawGameId = typeof report.gameId === "string" ? report.gameId : "unknown-game";
        const id = rawId.replace(/[^0-9A-Za-z._-]+/g, "-").replace(/^-|-$/g, "") || "report";
        const gameId = rawGameId.replace(/[^0-9A-Za-z._-]+/g, "-").replace(/^-|-$/g, "") || "unknown-game";
        const gameReportDir = resolve(reportDir, gameId);
        await mkdir(gameReportDir, { recursive: true });
        await writeFile(resolve(gameReportDir, `${id}.json`), `${JSON.stringify(report, null, 2)}\n`);
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: String(error) }));
      }
    });
  });

  server.on("error", (error) => {
    console.warn(`Invariant report sink unavailable on port ${reportSinkPort}: ${error.message}`);
  });
  server.listen(reportSinkPort, "127.0.0.1", () => {
    console.log(`Invariant reports will be written to ${reportDir}`);
  });
}

async function copyStatic() {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  await writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(resolve(root, "icons"), resolve(dist, "icons"), { recursive: true });
  await cp(resolve(root, "README.md"), resolve(dist, "README.md"));
  await mkdir(reportDir, { recursive: true });
  await rm(resolve(dist, "invariant-reports"), { force: true, recursive: true });
  await symlink("../invariant-reports", resolve(dist, "invariant-reports"), "dir");
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
startReportSink();

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
