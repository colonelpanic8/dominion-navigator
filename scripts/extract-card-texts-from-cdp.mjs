import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CDP_PORT = process.env.DOMINION_CDP_PORT ?? "9226";
const PASS_ENTRY = process.env.DOMINION_PASS_ENTRY ?? "dominion.games";
const OUTPUT_PATH = resolve(process.env.DOMINION_CARD_TEXT_OUTPUT ?? "data/dominion-card-shaped-objects.json");

function passLines(entry) {
  return execFileSync("pass", ["show", entry], { encoding: "utf8" }).split(/\r?\n/);
}

function credentials(entry) {
  const lines = passLines(entry);
  const password = lines[0] ?? "";
  const userLine = lines.find((line) => line.startsWith("user:"));
  const username = userLine?.replace(/^user:\s*/, "").trim();
  if (!username || !password) throw new Error(`Could not read username/password from pass entry ${entry}`);
  return { username, password };
}

class CdpConnection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      }
    };
    await new Promise((resolveOpen, rejectOpen) => {
      this.ws.onopen = resolveOpen;
      this.ws.onerror = rejectOpen;
    });
    return this;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const promise = new Promise((resolveSend) => this.pending.set(id, resolveSend));
    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  close() {
    this.ws?.close();
  }
}

async function browserConnection() {
  const version = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((response) => response.json());
  return new CdpConnection(version.webSocketDebuggerUrl).open();
}

async function pageConnection(webSocketDebuggerUrl) {
  const connection = await new CdpConnection(webSocketDebuggerUrl).open();
  await connection.send("Runtime.enable");
  await connection.send("Page.enable");
  return connection;
}

async function evaluate(page, expression, options = {}) {
  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    ...options
  });
  if (result.result?.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text);
  }
  return result.result?.result?.value;
}

async function waitFor(page, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(page, expression);
    if (last) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${expression}; last=${JSON.stringify(last)}`);
}

async function waitForLogin(page, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(
      page,
      `(() => {
        const body = document.body.innerText;
        const inputCount = document.querySelectorAll('input[placeholder="Username"], input[type="password"]').length;
        const user = angular.element(document.body).injector()?.get("meta")?.model?.me?.name;
        const loggedIn = body.includes("New Table") || body.includes("Matching") || (!!user && user !== "NoName") || inputCount === 0;
        if (!loggedIn) document.querySelector('input[type="submit"][value="Login"]')?.click();
        return { loggedIn, bodyStart: body.slice(0, 100), inputCount, user };
      })()`
    );
    if (last.loggedIn) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`Timed out waiting for login; last=${JSON.stringify(last)}`);
}

async function main() {
  const { username, password } = credentials(PASS_ENTRY);
  const browser = await browserConnection();
  const context = await browser.send("Target.createBrowserContext", { disposeOnDetach: false });
  const browserContextId = context.result.browserContextId;
  const target = await browser.send("Target.createTarget", {
    browserContextId,
    url: "about:blank",
    newWindow: true
  });
  if (target.error) throw new Error(`Target.createTarget failed: ${target.error.message}`);

  const targetInfo = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
    .then((response) => response.json())
    .then((targets) => targets.find((candidate) => candidate.id === target.result.targetId));
  if (!targetInfo) throw new Error("Could not locate created Dominion target");

  const page = await pageConnection(targetInfo.webSocketDebuggerUrl);
  await page.send("Page.navigate", { url: "https://dominion.games/" });
  await waitFor(page, `document.readyState === "complete" && !!window.angular`, 20000);
  await waitFor(page, `document.querySelectorAll('input').length > 0 || document.body.innerText.length > 0`, 20000);

  const loginResult = await evaluate(
    page,
    `(async () => {
      const { username, password } = ${JSON.stringify({ username, password })};
      const usernameInput = document.querySelector('input[placeholder="Username"], input[type="text"]');
      const passwordInput = document.querySelector('input[placeholder="Password"], input[type="password"]');
      if (!usernameInput || !passwordInput) {
        return { submitted: false, reason: 'login inputs not found', title: document.title, bodyText: document.body.innerText.slice(0, 500) };
      }
      const setValue = (input, value) => {
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.at(-1) ?? '' }));
        input.blur();
      };
      setValue(usernameInput, username);
      setValue(passwordInput, password);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const loginControl =
        [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Login') ??
        document.querySelector('input[type="submit"][value="Login"]');
      loginControl?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      loginControl?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      loginControl?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      loginControl?.click();
      passwordInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (document.querySelector('input[placeholder="Username"]')) loginControl?.click();
      return { submitted: true, title: document.title, loginControl: loginControl?.outerHTML?.slice(0, 200) };
    })()`
  );

  await waitForLogin(page);

  const extracted = await evaluate(
    page,
    `(() => {
      const asArray = (value) => Object.values(value ?? {});
      const textFor = (card) => {
        const language = window.LANGUAGE;
        const candidates = [
          language?.getCardText?.[card],
          window.EnglishCardTexts?.[card],
          window.EnglishCardTexts?.[card?.name],
          window.EnglishCardTexts?.[String(card)]
        ];
        return candidates.find((candidate) => typeof candidate === 'string') ?? null;
      };
      const nameFor = (card) => {
        const language = window.LANGUAGE;
        const candidates = [
          card?.name,
          language?.getCardName?.[card]?.singular,
          window.EnglishCardNames?.[card]?.singular,
          window.EnglishCardNames?.[card?.name]?.singular
        ];
        return candidates.find((candidate) => typeof candidate === 'string') ?? String(card);
      };
      const describe = (card, key) => ({
        key,
        name: nameFor(card),
        text: textFor(card),
        types: (card?.types ?? []).map((type) => type?.name ?? String(type)),
        expansion: card?.expansion?.name ?? null,
        pileName: card?.pileName?.name ?? null,
        isLandscape: typeof card?.isLandscape === 'function' ? card.isLandscape() : null,
        isBaseCard: typeof card?.isBaseCard === 'function' ? card.isBaseCard() : null
      });
      const cardNames = Object.entries(window.CardNames ?? {})
        .map(([key, card]) => describe(card, key))
        .filter((entry) => entry.name && entry.name !== 'undefined')
        .sort((a, b) => a.name.localeCompare(b.name));
      const typeCounts = {};
      for (const entry of cardNames) {
        for (const type of entry.types.length ? entry.types : ['<none>']) {
          typeCounts[type] = (typeCounts[type] ?? 0) + 1;
        }
      }
      return {
        extractedAt: new Date().toISOString(),
        url: location.href,
        loginUser: angular.element(document.body).injector()?.get('meta')?.model?.me?.name ?? null,
        version: window.VERSION ?? null,
        count: cardNames.length,
        typeCounts,
        cardShapedObjects: cardNames
      };
    })()`
  );

  await mkdir(resolve(OUTPUT_PATH, ".."), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify({ loginResult, ...extracted }, null, 2)}\n`);
  console.log(`Wrote ${extracted.count} card-shaped objects to ${OUTPUT_PATH}`);
  console.log(`Logged in as ${extracted.loginUser ?? username}`);
  await browser.send("Target.closeTarget", { targetId: target.result.targetId });
  await browser.send("Target.disposeBrowserContext", { browserContextId });
  page.close();
  browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
