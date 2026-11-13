import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LAUNCHER_BINDING, LAUNCHER_REPLY, parseLauncherRequest } from "../src/agent/launcher-protocol.ts";
import { AgentRunner } from "./lib/agent-runner.ts";
import { chromeProfile, createCdpSession, debugPort, debugUrl, LAUNCHER_PID_FILE, sleep } from "./lib/cdp.mjs";
import { loadConfig } from "./lib/config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(root, "dist");
const config = loadConfig();
const chrome = process.env.CHROME ?? config.chrome?.binary ?? "google-chrome-stable";
const profile = chromeProfile();
const pidFile = resolve(profile, LAUNCHER_PID_FILE);
const port = debugPort();
const url = process.env.DOMINION_NAVIGATOR_URL ?? config.chrome?.url ?? "https://dominion.games/";
const BLANK_PAGE_URLS = new Set(["about:blank", "chrome://newtab/", "chrome://new-tab-page/"]);

async function runningLauncherPid() {
  try {
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    process.kill(pid, 0);
    return pid;
  } catch {
    return undefined;
  }
}

// One launcher owns the profile. Starting another opens a tab in its Chrome instead.
const runningPid = await runningLauncherPid();
if (runningPid !== undefined) {
  const response = await fetch(debugUrl(port, `/json/new?${url}`), { method: "PUT" }).catch(() => undefined);
  if (response?.ok) {
    console.log(`Opened ${url} in the running Dominion Chrome (launcher pid ${runningPid}).`);
    process.exit(0);
  }
  // Its Chrome is gone, so the pid file is stale (or the pid was reused).
}

await mkdir(profile, { recursive: true });
const logFile = await open(resolve(profile, "chrome-with-extension.log"), "a");

const child = spawn(
  chrome,
  [
    `--user-data-dir=${profile}`,
    "--remote-debugging-pipe",
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=http://127.0.0.1,http://localhost",
    "--enable-unsafe-extension-debugging",
    "--ozone-platform-hint=auto",
    "--enable-features=WaylandWindowDecorations",
    "--enable-wayland-ime=true",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check"
  ],
  {
    stdio: ["ignore", "ignore", logFile.fd, "pipe", "pipe"]
  }
);

const agents = new AgentRunner(root);
const session = createCdpSession((data) => child.stdio[3].write(`${data}\0`), { onEvent: (message) => void handleEvent(message) });
let buffer = Buffer.alloc(0);

child.stdio[4].on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  let delimiterIndex;
  while ((delimiterIndex = buffer.indexOf(0)) !== -1) {
    const raw = buffer.subarray(0, delimiterIndex).toString("utf8");
    buffer = buffer.subarray(delimiterIndex + 1);
    if (raw) session.receive(raw);
  }
});

const send = session.send;

async function waitForDebugPort() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(debugUrl(port, "/json/version"));
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Chrome did not expose the debug port ${port}.`);
}

child.on("exit", (code, signal) => {
  agents.stopAll();
  console.error(`Chrome exited: code=${code ?? "null"} signal=${signal ?? "null"}`);
  process.exit(code ?? 1);
});

// Branded Chrome disables unpacked extensions that are reloaded any other way,
// so reloads also go through this pipe (see reload-extension.mjs).
async function loadExtension() {
  const result = await send("Extensions.loadUnpacked", { path: extensionPath });
  if (result.error) throw new Error(`Extensions.loadUnpacked failed: ${result.error.message}`);
  return result.result.id;
}

// Content scripts run in an isolated world named after the extension. The launcher binding is
// added to that world only, so the overlay can reach it and the page cannot. A binding added by
// name does not survive a new tab's first cross-process navigation, so it is added to each
// extension context as Chrome reports it.
const { name: extensionName } = JSON.parse(await readFile(resolve(extensionPath, "manifest.json"), "utf8"));
const attachedTargets = new Map();

/** The CDP session for a page, attached once with Runtime events on. Resolves to undefined if it cannot attach. */
function attachPage(targetId) {
  if (!attachedTargets.has(targetId)) {
    attachedTargets.set(
      targetId,
      (async () => {
        const sessionId = (await send("Target.attachToTarget", { targetId, flatten: true })).result?.sessionId;
        if (sessionId) await send("Runtime.enable", {}, sessionId);
        return sessionId;
      })()
    );
  }
  return attachedTargets.get(targetId);
}

function handleRequest(request) {
  switch (request.type) {
    case "start": {
      const started = agents.start(request.kind, request.token, request.prompt);
      return started.ok ? { ok: true, agents: agents.list(request.token) } : { ok: false, error: started.error, agents: agents.list(request.token) };
    }
    case "stop":
      agents.stop(request.token, request.agentId);
      return { ok: true, agents: agents.list(request.token) };
    case "status":
      return { ok: true, agents: agents.list(request.token) };
  }
}

async function handleEvent(message) {
  if (message.method === "Target.targetCreated" && message.params.targetInfo.type === "page") {
    await attachPage(message.params.targetInfo.targetId).catch(() => undefined);
  } else if (message.method === "Runtime.executionContextCreated" && message.params.context.name === extensionName) {
    await send("Runtime.addBinding", { name: LAUNCHER_BINDING, executionContextId: message.params.context.id }, message.sessionId);
  } else if (message.method === "Target.targetDestroyed") {
    attachedTargets.delete(message.params.targetId);
  } else if (message.method === "Runtime.bindingCalled" && message.params.name === LAUNCHER_BINDING) {
    const parsed = parseLauncherRequest(message.params.payload);
    const reply = parsed.ok ? { id: parsed.request.id, ...handleRequest(parsed.request) } : { id: parsed.id ?? -1, ok: false, error: parsed.error };
    await send(
      "Runtime.evaluate",
      { contextId: message.params.executionContextId, expression: `globalThis.${LAUNCHER_REPLY}?.(${JSON.stringify(JSON.stringify(reply))})` },
      message.sessionId
    );
  }
}

const extensionId = await loadExtension();

// Pages that loaded before the extension (including restored tabs) never get its
// content script, so reload those and open the URL only if no tab shows it yet.
const pages = ((await send("Target.getTargets")).result?.targetInfos ?? []).filter((target) => target.type === "page");
await send("Target.setDiscoverTargets", { discover: true });
for (const page of pages.filter((target) => !BLANK_PAGE_URLS.has(target.url))) {
  const sessionId = await attachPage(page.targetId);
  if (sessionId) await send("Page.reload", {}, sessionId);
}
if (!pages.some((target) => target.url.startsWith(url))) await send("Target.createTarget", { url });
for (const page of pages.filter((target) => BLANK_PAGE_URLS.has(target.url))) await send("Target.closeTarget", { targetId: page.targetId });

await waitForDebugPort();
console.log(`Dominion Navigator loaded as ${extensionId}`);
console.log(`Chrome debug port: http://127.0.0.1:${port}`);
console.log(`Profile: ${profile}`);

await writeFile(pidFile, `${process.pid}\n`);

async function shutdown() {
  agents.stopAll();
  try {
    await rm(pidFile, { force: true });
    await send("Browser.close");
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", () => {
  loadExtension().then(
    (id) => console.log(`Reloaded Dominion Navigator as ${id}`),
    (error) => console.error(String(error))
  );
});

// Keep the launcher process alive even when it is started detached with stdin
// connected to /dev/null. Chrome's remote-debugging pipe closes when this
// process exits, which unloads the extension with it.
setInterval(() => {}, 60 * 60 * 1000);
