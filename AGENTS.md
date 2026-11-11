# Working in this repository

## Driving a live game

Play and inspect dominion.games through the `dominion` MCP server (`scripts/mcp-server.ts`, registered in `.mcp.json`), not through screenshots or page clicks. The README's "Playing Through MCP" section lists the tools.

- The server attaches to the Chrome that `npm run launch:chrome` starts. Run `npm run build` first, and log in to dominion.games in that Chrome.
- `state` tells you which screen the client is on. `new_game` starts a bot game from any screen, with a chosen kingdom if you pass one.
- After changing code under `src/`, run `npm run build && npm run reload:extension`. The reload refreshes the tab, and the client reconnects to a running game after a few seconds.
- `inspect` reads raw client and tracker state. Use it to check the tracker against the client, not to pick plays.
- The test account owns only the base set. A kingdom with other cards is accepted by the table and then never starts.

## Checks

`npm run check` is what CI runs. For a narrower loop, `npm run typecheck` and `npm test`.
