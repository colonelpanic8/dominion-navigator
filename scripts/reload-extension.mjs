import { connectCdp, debugPort, debugUrl, evaluate, fetchJson, sleep } from "./lib/cdp.mjs";

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

async function reloadExtension() {
  const page = await getOrOpenExtensionsPage();
  const client = await connectCdp(page.webSocketDebuggerUrl);
  await client.send("Runtime.enable");

  const expression = `(async () => {
    const infos = await new Promise((resolve) => chrome.developerPrivate.getExtensionsInfo(
      { includeDisabled: true, includeTerminated: true },
      resolve
    ));
    const extension = infos.find((info) => info.name === "Dominion Navigator" || info.path === ${JSON.stringify(extensionPath)});
    if (!extension) return { ok: false, reason: "Dominion Navigator is not loaded." };
    const reload = await new Promise((resolve) => chrome.developerPrivate.reload(
      extension.id,
      { failQuietly: false },
      () => resolve({ lastError: chrome.runtime.lastError?.message ?? null })
    ));
    return { ok: !reload.lastError, id: extension.id, path: extension.path, reason: reload.lastError };
  })()`;

  const value = await evaluate(client, expression).finally(() => client.close());
  if (!value?.ok) throw new Error(value?.reason ?? "Extension reload failed.");
  return value;
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
