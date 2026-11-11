import { connectCdp, debugPort, debugUrl, evaluate, fetchJson } from "./lib/cdp.mjs";

const port = debugPort("CDP_PORT");

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

async function evaluateInDominion(expression, timeoutMs = 90000) {
  const pages = await fetchJson(debugUrl(port, "/json/list"));
  const page = pages.find((candidate) => candidate.url?.startsWith("https://dominion.games/"));
  if (!page) throw new Error(`No dominion.games tab found on CDP port ${port}`);

  const client = await connectCdp(page.webSocketDebuggerUrl, { timeoutMs });
  try {
    await client.send("Runtime.enable");
    return await evaluate(client, expression);
  } finally {
    client.close();
  }
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
