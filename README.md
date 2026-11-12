# Dominion Navigator

Dominion Navigator is a Chrome extension prototype for `dominion.games`. It tracks card locations from the in-page Dominion game model instead of parsing the visible log, and keeps a separate model of what the player is actually allowed to know.

## How It Works

- A content script runs on `https://dominion.games/*` and injects `page-probe.js` into the page context.
- The page probe reads the Angular `game` service:

  ```js
  angular.element(document.body).injector().get("game")
  ```

- It snapshots all player-owned zones and hooks `CardMove.prototype.execute` to emit card-move events (before and after each move). Draw piles are always reported as card backs.
- The content script feeds those events into a knowledge model and renders an overlay (collapsed by default) with each player's known/unknown cards, the hero's zones, and recent moves.
- Clicking any player's draw or discard pile, or the overlay's "Open Draw Window" button, opens a card-details modal with that player's draw pile, discard pile, cards outside the active deck, and entire deck.
- Game-log lines that reveal hidden cards (`X topdecks ...`, `X reveals their hand: ...`, `X reacts with ...`) are applied to the model.
- Tracker state is saved to `chrome.storage.local` and restored after a page reload of the same game (same URL, game number, players, and setup, within 24 hours).

The knowledge model separates Dominion's internal zone state from what the player can know:

- Total ownership is tracked as its own ledger.
- Gains are detected when cards move from non-player zones into a player's zones.
- Trashes, returns to supply, and other losses are detected when cards move from a player's zones into non-player zones.
- Transfers between player-owned zones update both players' ownership ledgers.
- Visible cards are tracked by name and zone; anonymous cards are tracked as unknown counts.
- Card moves update known locations when the client reveals identities.
- Known owned cards whose current location is uncertain are kept as "known, unlocated."
- "Identity repair" (overlay checkbox, off by default) lets visible zone evidence identify anonymous owned cards.

## Source Layout

- `src/messages.ts`: the `window.postMessage` protocol between the page probe and the content script (`ProbeMessage` from the probe, `ContentCommand` to it). `src/message-bus.ts` posts and receives them; `src/message-validation.ts` checks every incoming message's shape, since any page script can post on the same channel.
- `src/page-probe.ts`: page-context entry point: probe state, client hooks, command handling, and the agent API.
  - `src/probe/runtime-types.ts`: the client objects the probe reads.
  - `src/probe/summaries.ts`: serializes zones, snapshots, and card moves.
  - `src/probe/knowledge-modal.ts`: the card-details modal, rendered with the client's own card stacks.
  - `src/probe/questions.ts`: reads the client's open questions and answers them.
  - `src/probe/table-state.ts`: public table state (supply, landscapes, trash, counters, turn).
  - `src/probe/agent-bridge.ts`: the agent API on `window.__dominionNavigator`.
  - `src/probe/session.ts`: which screen the client is on, and starting and resigning bot games.
- `src/agent/`: pure, Node-testable agent code: the `agent-view@1` projection (`agent-view.ts`), its text and delta rendering (`render-text.ts`), decision building and answer validation (`decisions.ts`), notes for expansion state (`table-notes.ts`), the raw-state dump (`inspect.ts`), the card glossary, and policies.
- `scripts/mcp-server.ts`: the MCP server. `scripts/lib/dominion-tools.ts` defines its tools, `scripts/lib/dominion-client.ts` calls the probe over CDP, and `scripts/lib/mcp-stdio.ts` is the stdio transport.
- `src/content-script.ts`: extension entry point that wires the pieces below together.
  - `src/content/overlay.ts`: the shadow-DOM overlay.
  - `src/content/knowledge-window.ts`: builds the card-details modal payload.
  - `src/content/invariants.ts`: count-invariant checks and reports.
  - `src/content/persistence.ts`: save/restore of tracker state.
  - `src/content/log-watcher.ts`: applies knowledge-revealing log lines.
- `src/knowledge.ts`: `DeckKnowledgeTracker`, the knowledge model.
- `src/log-parser.ts`, `src/topdeck-tracking.ts`: log-line parsing and matching anonymous topdecks to their log lines.

## Development

Install dependencies and build the unpacked extension into `dist/`:

```sh
npm ci
npm run build
```

Launch a dedicated Chrome profile with the unpacked extension loaded:

```sh
npm run launch:chrome
```

Chrome 137+ no longer reliably supports `--load-extension` in branded builds, so the launcher loads `dist/` through the DevTools `Extensions.loadUnpacked` pipe API, keeps that pipe alive, and then opens `dominion.games`. Branded Chrome also disables an unpacked extension that is reloaded through `chrome://extensions` APIs, so `npm run reload:extension` asks the launcher (via a `SIGHUP` to the pid in `<profile>/launcher.pid`) to reload it over the same pipe, then checks that it is still enabled. The launcher accepts these environment variables:

- `CHROME`: Chrome binary (default `google-chrome-stable` on `PATH`).
- `DOMINION_NAVIGATOR_CHROME_PROFILE`: profile directory (default `/tmp/dominion-navigator-chrome-profile4`).
- `DOMINION_NAVIGATOR_DEBUG_PORT`: DevTools port (default `9226`). All CDP scripts read it.
- `DOMINION_NAVIGATOR_URL`: page to open (default `https://dominion.games/`).

For normal hacking, keep the launcher running in one terminal and the dev loop in another:

```sh
npm run dev
```

The dev loop watches the TypeScript entry points, rebuilds `dist/`, reloads the extension, and refreshes open `dominion.games` tabs. To rebuild and reload once instead:

```sh
npm run build
npm run reload:extension
```

To use your normal Chrome profile instead, open `chrome://extensions`, enable Developer Mode, click "Load unpacked", and choose `dist/`. Chrome does not expose the reload API to a profile that was not started with the debug port, so use the build-only watcher and reload the extension from `chrome://extensions` after changes:

```sh
npm run dev:build
```

Before pushing, run the same checks as CI (icons, type-check of `src/`, `tests/` and `scripts/`, tests, build, and the release zip in `releases/`):

```sh
npm run check
```

## Agent API

The probe exposes a machine-readable view of the game and a way to answer the game's questions, for harnesses that drive a game over CDP:

```js
window.__dominionNavigator.getAgentView()      // dominion-navigator/agent-view@1 JSON
window.__dominionNavigator.getAgentViewText()  // compact text rendering of the same view
await window.__dominionNavigator.waitForDecision({ timeoutMs: 60000 })
window.__dominionNavigator.answer(decisionId, [optionIndex, ...])
```

The view combines public table state (supply, landscapes, trash, counters) with per-player card knowledge taken only from the knowledge model, so it never contains hidden information the player could not know. `decision` lists the open question's option groups and options. Card options carry their current cost and are listed by cost, then name, so the same cards always list alike. `turn.treasureInHand.made` gives what each fixed-value Treasure in hand makes, and the text rendering shows that on Treasures to play (`Silver +$2`) instead of their cost, or nothing for one whose value is not fixed. When the groups are alternatives (the client's question is an OR), `decision.alternatives` lists the groups each alternative holds. A split or mixed pile, such as Forts or Knights, lists its other cards under `others`. `answer` only accepts option indices for a decision that is still open, enforces each group's min/max, and refuses to act when the account is spectating. The turn phase is derived from the open decision, since the client does not track it.

`scripts/agent-play.ts` plays the current game through this API with a pluggable policy (`src/agent/policy.ts`). The included `big-money` policy plays treasures and buys Province at $8, Gold at $6-7 and Silver at $3-5, with an optional terminal Action:

```sh
npm run agent:play -- --policy big-money --terminal Remodel --record decisions.jsonl
```

`--record` writes one JSON line per decision (view, text rendering, choice, result) plus a per-game card glossary built from `data/dominion-card-shaped-objects.json`.

The same handle also covers everything outside a decision:

```js
window.__dominionNavigator.getSession()                          // screen (login, lobby, table, game), table seats, bots or humans
await window.__dominionNavigator.startBotGame({ bots: 1, kingdom: ["Sentry", "Chapel"] })
await window.__dominionNavigator.resign()
window.__dominionNavigator.getLog({ afterIndex: 40, limit: 50 }) // the whole game log, with entry indices
window.__dominionNavigator.inspect("game.state.zones.3", { depth: 2 })
```

`startBotGame` works from the lobby, a table, or a finished game. `kingdom` names cards and landscapes the table must use, and a split pile by any of its cards or its plural (Tent or Forts both give the Fort pile); the server fills the rest at random, and silently refuses to start a kingdom with cards the account cannot play. `inspect` dumps raw client or tracker state at a dotted path (roots: `game`, `table`, `meta`, `knowledge`, `probe`, `window`). It is for debugging: unlike the view, it is not limited to what the player may know.

## Playing Through MCP

`scripts/mcp-server.ts` serves the agent API as [Model Context Protocol](https://modelcontextprotocol.io) tools over stdio, so an agent can play and inspect a game without screenshots. It attaches to the Chrome that `npm run launch:chrome` started, with dominion.games logged in.

The repository's `.mcp.json` registers it as `dominion` for Claude Code sessions started here. To register it elsewhere, run it from this directory:

```sh
node --import tsx scripts/mcp-server.ts
```

| Tool | What it does |
| --- | --- |
| `state` | The client's screen and, in a game, the whole table plus the text of every card in it. A finished game shows only its result and each player's cards. |
| `step` | Answers the open decision by option label or number, waits for the next decision, and returns what changed. |
| `wait` | Waits for the next decision without answering. |
| `new_game` | Starts an unrated bot game, optionally with a chosen kingdom. |
| `resign` | Resigns the game in progress. |
| `log` | Rereads the game log. |
| `cards` | Card text, types and current cost by name. |
| `inspect` | Raw client or tracker state at a path, for debugging. |

`step` takes each option as a label or a number. Labels are the safer default, because a card's number can change between decisions. A label matches without case (`"Silver"`), may carry its group kind to pick between groups (`"buy:Silver"`, `"play:Copper"`), and takes one more matching option each time it is repeated (`["Copper", "Copper"]`). A label that matches nothing, or options that are not interchangeable, fails without acting and lists the options. Labels are resolved by the MCP server; the page API takes option numbers only.

`step` first echoes what it chose by label, as a `CHOSE` line. `step` and `wait` return a delta against the view the caller was last shown: the status line, new log lines and the next decision in full, and only the players and piles that changed. `state` prints everything, except for a finished game. Each opponent turn that ends within the new log lines gets an `OPPONENT TURNS` line with the $ it made and what it bought and gained. Decisions with a single legal answer are answered on the way and reported as `AUTO` lines. In a recorded nine-turn game an agent made 27 `step` calls, and the results averaged 838 characters.

`step` refuses to act in a game that seats human opponents. Start the server with `--allow-human-opponents` to lift that.

`step` also takes an optional `reason`, a short note on why the agent chose what it did. Start the server with `--game-log-dir <dir>` (or set `DOMINION_GAME_LOG_DIR`) to keep a log of each game under that directory, named by game number:

- `<game>.jsonl` has one JSON record per line: a `decision` record for each answered decision (time, game number, turn, decision id and prompt, group kinds, the chosen options' labels, numbers and groups, and the `reason` if one was given), an `auto` record for each decision answered for the agent, and a `result` record once the game's result is shown.
- `<game>.md` has one readable line per record, such as `- T5 buy: Silver — money before Gold`.

Without the flag nothing is written. A failed write is reported on stderr and never fails the tool call.

An extra turn is marked on the status line, as in `turn 12 (extra turn: seize the day)`, and a pile's Trait on the pile and on options for its cards, as in `Old Witch $5 [trait: Reckless]`. A finished game's `RESULT` gives each player's turns and, when the supply or a resignation shows it, how the game ended. In the buy phase, a `NOTE` names the unplayed treasures the buy list does not count (a value that is not fixed, such as Bank's) or that buying would never play (one that does more than make money), with the options that play them.

State the view has no field for (tokens, counters on piles or cards, bought projects, reminders, who controls the turn) is printed under `ALSO`. That part is read generically from the client and has not been checked against a live game that uses those mechanics.

## Debugging

Useful page-context handles after the probe is injected:

```js
window.__dominionNavigator.game
window.__dominionNavigator.events
window.__dominionNavigator.requestSnapshot()
```

Known useful fields on the `game` service:

- `game.state.zones`
- `game.state.cards`
- `game.state.players`
- `game.playerModel.hero`
- `game.playerModel.playerMe`
- `game.questionModel.gameButtons`
- `CardMove.prototype.execute`

### Invariant reports

The content script checks exact observed `HandZone` and `DrawZone` counts against the knowledge model after card moves and snapshots. When a mismatch appears, it stores an invariant report in `chrome.storage.local`, logs it to the console, and repairs the tracked zone counts so the UI keeps matching the observed hand/draw sizes.

While `npm run dev` is running, a local report sink on `127.0.0.1:9237` also mirrors those reports by game id into:

```sh
dist/invariant-reports/<game-id>/
```

That `dist/` path is a symlink to the repo-root `invariant-reports/` directory, so reports survive rebuilds of the unpacked extension.

`<game-id>` uses the Dominion game number when the page exposes one, and falls back to the probe's generated game instance id. Repeated reports for the same active violation fingerprint are suppressed until the invariant passes once.

Chrome extensions cannot write files into their unpacked extension directory, so the file mirror is provided by the dev watcher. Without the watcher, the reports remain available in extension storage and the page console.

## Card Data

The machine-readable card text and tracker audit live in one file:

```sh
data/dominion-card-shaped-objects.json
```

That file contains the extracted Dominion client card-shaped objects plus a `trackerAudit` object with stable category IDs, category counts, candidate card keys, and per-card audit records keyed by card key. `trackerAudit.behaviorReview` narrows the audit into `must-check`, `watch`, and `normal` cards for tracker-specific behavior testing. See `data/card-data-audit-notes.md` for the audit and the live verification ledger.

Related scripts (the extract and kingdom scripts drive a Chrome started by `npm run launch:chrome`):

- `node scripts/extract-card-texts-from-cdp.mjs`: logs in (credentials from the `pass` entry in `DOMINION_PASS_ENTRY`, default `dominion.games/colonelpanic8`) and re-extracts the card-shaped objects.
- `node scripts/audit-card-tracker-candidates.mjs`: regenerates `trackerAudit` in place (no browser needed).
- `node scripts/set-table-kingdom.mjs [--no-bot] <card>...`: fills the open table editor with a fixed kingdom and, by default, adds a bot.
