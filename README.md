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

- `src/messages.ts`: the `window.postMessage` protocol between the page probe and the content script (`ProbeMessage` from the probe, `ContentCommand` to it).
- `src/page-probe.ts`: page-context entry point: probe state, client hooks, and command handling.
  - `src/probe/runtime-types.ts`: the client objects the probe reads.
  - `src/probe/summaries.ts`: serializes zones, snapshots, and card moves.
  - `src/probe/knowledge-modal.ts`: the card-details modal, rendered with the client's own card stacks.
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

Chrome 137+ no longer reliably supports `--load-extension` in branded builds, so the launcher loads `dist/` through the DevTools `Extensions.loadUnpacked` pipe API, keeps that pipe alive, and then opens `dominion.games`. It accepts these environment variables:

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

Before pushing, run the same checks as CI (icons, type-check of `src/` and `tests/`, tests, build, and the release zip in `releases/`):

```sh
npm run check
```

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

- `node scripts/extract-card-texts-from-cdp.mjs`: logs in (credentials from the `pass` entry in `DOMINION_PASS_ENTRY`) and re-extracts the card-shaped objects.
- `node scripts/audit-card-tracker-candidates.mjs`: regenerates `trackerAudit` in place (no browser needed).
- `node scripts/set-table-kingdom.mjs [--no-bot] <card>...`: fills the open table editor with a fixed kingdom and, by default, adds a bot.
