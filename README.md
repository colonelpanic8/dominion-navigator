# Dominion Navigator

Dominion Navigator is a Chrome extension prototype for `dominion.games`. It tracks the current player's card locations from the in-page Dominion game model instead of parsing the visible log.

## Current Approach

- A content script runs on `https://dominion.games/*`.
- The content script injects `page-probe.js` into the page context.
- The page probe reads the Angular `game` service:

  ```js
  angular.element(document.body).injector().get("game")
  ```

- It snapshots hero-owned zones and hooks `CardMove.prototype.execute` to emit movement events.
- It snapshots all player-owned zones so the extension can maintain a separate knowledge model.
- The content script renders a small overlay with known/unknown card locations, current zones, and recent card moves.

The knowledge model intentionally separates Dominion's internal zone state from what the player can know:

- Total ownership is tracked as its own ledger.
- Gains are detected when cards move from non-player zones into a player's zones.
- Trashes, returns to supply, and other losses are detected when cards move from a player's zones into non-player zones.
- Transfers between player-owned zones update both players' ownership ledgers.
- Visible cards are tracked by name and zone.
- Anonymous cards are tracked as unknown counts.
- Card moves update known locations when the client reveals identities.
- Known owned cards whose current location is uncertain are kept as "known, unlocated."

## Development

Install dependencies:

```sh
npm install
```

Build the unpacked extension:

```sh
npm run build
```

Launch the dedicated Chrome profile with the unpacked extension loaded:

```sh
npm run launch:chrome
```

Chrome 137+ no longer reliably supports the old `--load-extension` workflow in branded Chrome builds, so the launcher uses the DevTools `Extensions.loadUnpacked` pipe API and keeps that pipe alive.

After editing code, rebuild and reload the already-loaded extension plus any open `dominion.games` tabs:

```sh
npm run build
npm run reload:extension
```

For normal hacking, keep the launcher running in one terminal and use the dev loop in another:

```sh
npm run dev
```

The dev loop watches the bundled TypeScript entry points, rebuilds `dist/`, reloads the extension, and refreshes open `dominion.games` tabs so content-script changes are applied.

You do not need to reinstall the extension while hacking. Load the unpacked extension from `dist/` once, then use `npm run dev` to rebuild and reload it after each change. The provided launcher does the one-time unpacked load for a dedicated Chrome profile:

```sh
npm run build
npm run launch:chrome
```

If you load it manually in your normal Chrome profile instead, open `chrome://extensions`, enable Developer Mode, click "Load unpacked", and choose this repo's `dist/` directory. After that, `npm run dev` or `npm run reload:extension` is enough.

For a normal Chrome profile that was not launched with `npm run launch:chrome`, use the build-only watcher:

```sh
npm run dev:build
```

Chrome does not expose the reload API to an already-running normal profile unless it was started with this repo's debug port. With `npm run dev:build`, reload the unpacked extension from `chrome://extensions` after changes.

Type-check and build:

```sh
npm run check
```

## Debugging

Useful page-context handles after the probe is injected:

```js
window.__dominionNavigator
window.__dominionNavigator.requestSnapshot()
window.__dominionNavigator.events
```

The most important runtime model is:

```js
angular.element(document.body).injector().get("game")
```

Known useful fields:

- `game.state.zones`
- `game.state.cards`
- `game.state.players`
- `game.playerModel.hero`
- `game.playerModel.playerMe`
- `CardMove.prototype.execute`

The content-side tracker lives in `src/knowledge.ts`.

## Card Data

The machine-readable card text and tracker audit live in one file:

```sh
data/dominion-card-shaped-objects.json
```

That file contains the extracted Dominion client card-shaped objects plus a `trackerAudit` object with stable category IDs, category counts, candidate card keys, and per-card audit records keyed by card key. `trackerAudit.behaviorReview` narrows the audit into `must-check`, `watch`, and `normal` cards for tracker-specific behavior testing.
