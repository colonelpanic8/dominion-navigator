import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCdpSession, debugPort, debugUrl, sleep } from "./lib/cdp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(root, "dist");
const chrome = process.env.CHROME ?? "google-chrome-stable";
const profile = process.env.DOMINION_NAVIGATOR_CHROME_PROFILE ?? "/tmp/dominion-navigator-chrome-profile4";
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

const loadResult = await send("Extensions.loadUnpacked", { path: extensionPath });
if (loadResult.error) {
  throw new Error(`Extensions.loadUnpacked failed: ${loadResult.error.message}`);
}

// Open the URL only now: tabs that loaded before the extension never get its content script.
const blankPages = ((await send("Target.getTargets")).result?.targetInfos ?? []).filter(
  (target) => target.type === "page" && BLANK_PAGE_URLS.has(target.url)
);
await send("Target.createTarget", { url });
for (const page of blankPages) await send("Target.closeTarget", { targetId: page.targetId });

await waitForDebugPort();
console.log(`Dominion Navigator loaded as ${loadResult.result.id}`);
console.log(`Chrome debug port: http://127.0.0.1:${port}`);
console.log(`Profile: ${profile}`);

async function shutdown() {
  try {
    await send("Browser.close");
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep the launcher process alive even when it is started detached with stdin
// connected to /dev/null. Chrome's remote-debugging pipe closes when this
// process exits, which unloads the extension with it.
setInterval(() => {}, 60 * 60 * 1000);
