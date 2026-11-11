import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromeProfile, connectCdp, debugPort, debugUrl, evaluate, fetchJson, LAUNCHER_PID_FILE, sleep } from "./lib/cdp.mjs";

const port = debugPort();
const extensionPath = new URL("../dist/", import.meta.url).pathname.replace(/\/$/, "");
const reloadPages = !process.argv.includes("--no-page-reload");

async function getOrOpenExtensionsPage() {
  let targets = await fetchJson(debugUrl(port, "/json/list"));
  let page = targets.find((target) => target.url.startsWith("chrome://extensions/"));
  if (page) return page;

  await fetchJson(debugUrl(port, "/json/new?chrome://extensions/"), { method: "PUT" });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    targets = await fetchJson(debugUrl(port, "/json/list"));
    page = targets.find((target) => target.url.startsWith("chrome://extensions/"));
    if (page) return page;
    await sleep(100);
  }
  throw new Error("Unable to open chrome://extensions.");
}

const findExtension = `chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, resolve)`;

async function extensionInfo(client) {
  return evaluate(
    client,
    `(async () => {
      const infos = await new Promise((resolve) => ${findExtension});
      const extension = infos.find((info) => info.name === "Dominion Navigator" || info.path === ${JSON.stringify(extensionPath)});
      return extension && { id: extension.id, state: extension.state, disableReasons: extension.disableReasons };
    })()`
  );
}

async function launcherPid() {
  try {
    const pid = Number((await readFile(resolve(chromeProfile(), LAUNCHER_PID_FILE), "utf8")).trim());
    process.kill(pid, 0);
    return pid;
  } catch {
    return undefined;
  }
}

/**
 * Branded Chrome disables an unpacked extension reloaded through
 * chrome.developerPrivate, so prefer asking the launcher to reload it over its
 * DevTools pipe, and verify the extension is still enabled afterwards.
 */
async function reloadExtension() {
  const page = await getOrOpenExtensionsPage();
  const client = await connectCdp(page.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    const before = await extensionInfo(client);
    if (!before) throw new Error("Dominion Navigator is not loaded.");

    const pid = await launcherPid();
    if (pid) {
      process.kill(pid, "SIGHUP");
      await sleep(1000);
    } else {
      await evaluate(
        client,
        `new Promise((resolve) => chrome.developerPrivate.reload(${JSON.stringify(before.id)}, { failQuietly: false }, () => resolve(chrome.runtime.lastError?.message ?? null)))`
      );
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const info = await extensionInfo(client);
      if (info?.state === "ENABLED") return info;
      await sleep(200);
    }
    const info = await extensionInfo(client);
    const reasons = Object.entries(info?.disableReasons ?? {})
      .filter(([, value]) => value)
      .map(([key]) => key);
    throw new Error(
      `Dominion Navigator is ${info?.state ?? "missing"} after reload${reasons.length ? ` (${reasons.join(", ")})` : ""}. ` +
        "Start Chrome with `npm run launch:chrome` so reloads go through its DevTools pipe."
    );
  } finally {
    client.close();
  }
}

async function reloadDominionPages() {
  const targets = await fetchJson(debugUrl(port, "/json/list"));
  const pages = targets.filter((target) => target.type === "page" && target.url.startsWith("https://dominion.games/"));
  for (const page of pages) {
    const client = await connectCdp(page.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Page.reload", { ignoreCache: true });
    client.close();
  }
  return pages.length;
}

const extension = await reloadExtension();
const pageCount = reloadPages ? await reloadDominionPages() : 0;
console.log(`Reloaded Dominion Navigator (${extension.id}).`);
if (reloadPages) console.log(`Reloaded ${pageCount} dominion.games tab${pageCount === 1 ? "" : "s"}.`);
