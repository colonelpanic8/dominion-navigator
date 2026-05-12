const port = Number(process.env.DOMINION_NAVIGATOR_DEBUG_PORT ?? "9226");
const extensionPath = new URL("../dist/", import.meta.url).pathname.replace(/\/$/, "");
const reloadPages = !process.argv.includes("--no-page-reload");

async function json(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function connect(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };

  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  return {
    opened,
    send(method, params = {}) {
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    }
  };
}

async function getOrOpenExtensionsPage() {
  let targets = await json(`http://127.0.0.1:${port}/json/list`);
  let page = targets.find((target) => target.url.startsWith("chrome://extensions/"));
  if (page) return page;

  await json(`http://127.0.0.1:${port}/json/new?chrome://extensions/`, { method: "PUT" });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    targets = await json(`http://127.0.0.1:${port}/json/list`);
    page = targets.find((target) => target.url.startsWith("chrome://extensions/"));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Unable to open chrome://extensions.");
}

async function reloadExtension() {
  const page = await getOrOpenExtensionsPage();
  const client = connect(page.webSocketDebuggerUrl);
  await client.opened;
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

  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  client.close();

  const value = result.result?.result?.value;
  if (!value?.ok) throw new Error(value?.reason ?? "Extension reload failed.");
  return value;
}

async function reloadDominionPages() {
  const targets = await json(`http://127.0.0.1:${port}/json/list`);
  const pages = targets.filter((target) => target.type === "page" && target.url.startsWith("https://dominion.games/"));
  for (const page of pages) {
    const client = connect(page.webSocketDebuggerUrl);
    await client.opened;
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
