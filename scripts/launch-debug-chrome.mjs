import { spawn } from "node:child_process";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromeProfile, createCdpSession, debugPort, debugUrl, LAUNCHER_PID_FILE, sleep } from "./lib/cdp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(root, "dist");
const chrome = process.env.CHROME ?? "google-chrome-stable";
const profile = chromeProfile();
const pidFile = resolve(profile, LAUNCHER_PID_FILE);
const port = debugPort();
const url = process.env.DOMINION_NAVIGATOR_URL ?? "https://dominion.games/";
const BLANK_PAGE_URLS = new Set(["about:blank", "chrome://newtab/", "chrome://new-tab-page/"]);

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

const session = createCdpSession((data) => child.stdio[3].write(`${data}\0`));
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

const extensionId = await loadExtension();

// Pages that loaded before the extension (including restored tabs) never get its
// content script, so reload those and open the URL only if no tab shows it yet.
const pages = ((await send("Target.getTargets")).result?.targetInfos ?? []).filter((target) => target.type === "page");
for (const page of pages.filter((target) => !BLANK_PAGE_URLS.has(target.url))) {
  const attached = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  const sessionId = attached.result?.sessionId;
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
