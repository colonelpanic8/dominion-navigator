import http from "node:http";

const DEFAULT_CDP_PORT = Number(process.env.CDP_PORT ?? 9226);

function usage() {
  console.error("Usage: node scripts/set-table-kingdom.mjs [--no-bot] <card> [<card> ...]");
  console.error('Example: node scripts/set-table-kingdom.mjs Lurker Fortress Chapel Workshop Village Smithy Market Remodel Mine Cellar');
}

const args = process.argv.slice(2);
const addBot = !args.includes("--no-bot");
const cardNames = args.filter((arg) => arg !== "--no-bot");

if (cardNames.length === 0) {
  usage();
  process.exit(1);
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: DEFAULT_CDP_PORT, path }, (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => resolve(JSON.parse(data)));
      })
      .on("error", reject);
  });
}

async function evaluateInDominion(expression, timeoutMs = 90000) {
  const pages = await getJson("/json/list");
  const page = pages.find((candidate) => candidate.url?.startsWith("https://dominion.games/"));
  if (!page) throw new Error(`No dominion.games tab found on CDP port ${DEFAULT_CDP_PORT}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const call = { id: ++id, method, params };
      const timer = setTimeout(() => {
        if (pending.delete(call.id)) reject(new Error(`${method} timed out`));
      }, timeoutMs);
      pending.set(call.id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      ws.send(JSON.stringify(call));
    });

  await send("Runtime.enable");
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  ws.close();

  if (response.error) throw new Error(JSON.stringify(response.error));
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result?.result?.value;
}

const result = await evaluateInDominion(`(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const names = ${JSON.stringify(cardNames)};
  const shouldAddBot = ${JSON.stringify(addBot)};
  const injector = angular.element(document.body).injector();
  const root = injector.get("$rootScope");
  const clickVisibleText = (text) => {
    const candidates = Array.from(document.querySelectorAll("button, .lobby-button, .game-button, div, label, span"));
    const target = candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (element.innerText || element.textContent || "").trim() === text;
    });
    if (!target) return false;
    target.click();
    return true;
  };

  if (!document.querySelector("KINGDOM-RULES")) {
    clickVisibleText("Edit Table") || clickVisibleText("My Table");
    await sleep(3000);
  }

  if (!document.querySelector("KINGDOM-RULES") || !document.querySelector("TABLE-CARD-SELECTOR")) {
    throw new Error("Dominion table editor is not visible. Open My Table or the score screen's Edit Table view first.");
  }

  if (shouldAddBot) {
    const emptySlot = document.querySelector("TABLE-EMPTY-SLOT");
    if (emptySlot) {
      angular.element(emptySlot).data().$tableEmptySlotController.addBot();
      root.$applyAsync();
      await sleep(2500);
    }
  }

  const kingdomRules = angular.element(document.querySelector("KINGDOM-RULES")).data().$kingdomRulesController;
  const selector = angular.element(document.querySelector("TABLE-CARD-SELECTOR")).data().$tableCardSelectorController;
  kingdomRules.clearKingdom();
  root.$applyAsync();
  await sleep(2500);

  const added = [];
  const missing = [];
  for (const name of names) {
    selector.searchString = name;
    selector.updateSearchString();
    const card = selector.rawSearchObjects.find((object) => object.name === name);
    if (!card) {
      missing.push(name);
      continue;
    }
    selector.addCard(card);
    added.push(name);
    root.$applyAsync();
    await sleep(250);
  }

  await sleep(2500);
  return {
    added,
    missing,
    players: (document.body.innerText.match(/Players \\(\\d+\\/\\d+\\)[\\s\\S]*?Randomize Player Order/)?.[0] ?? "").trim(),
    kingdom: names.join(", "),
    visibleText: document.body.innerText.slice(0, 2500)
  };
})()`);

console.log(JSON.stringify(result, null, 2));
