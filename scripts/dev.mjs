import { spawn } from "node:child_process";
import { watchFile } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import * as esbuild from "esbuild";
import { cleanDist, copyStatic, esbuildConfigs, reportDir, root } from "./lib/extension-build.mjs";

const autoReload = !process.argv.includes("--no-auto-reload");
// Must match INVARIANT_REPORT_SINK_URL in src/content/invariants.ts and the manifest host_permissions.
const reportSinkPort = 9237;
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

await cleanDist();
await copyStatic();
startReportSink();

const contexts = await Promise.all(esbuildConfigs({ plugins: [reloadPlugin()] }).map((config) => esbuild.context(config)));

for (const context of contexts) await context.watch();

for (const file of [resolve(root, "manifest.json"), resolve(root, "README.md")]) {
  watchFile(file, { interval: 300 }, scheduleReload);
}

if (autoReload) {
  console.log("Watching extension sources and reloading Chrome. Press Ctrl-C to stop.");
} else {
  console.log("Watching extension sources without Chrome auto-reload. Press Ctrl-C to stop.");
}
