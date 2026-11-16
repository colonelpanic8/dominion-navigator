# Shared Dominion gameplay compatibility

Dominion Navigator remains the browser extension and MCP backend for **dominion.games**.
It shares gameplay vocabulary with dominion-arena; the repositories and game backends
remain separate.

The source contract is dominion-playbook's
[`protocol/tools.md`](https://github.com/colonelpanic8/dominion-playbook/blob/main/protocol/tools.md)
(`dominion/play@1`) and
[`protocol/README.md`](https://github.com/colonelpanic8/dominion-playbook/blob/main/protocol/README.md)
(`dominion/agent-view@2`). [agent-view.schema.json](agent-view.schema.json) is an
unmodified snapshot of that repository's canonical schema copied on 2026-11-15.
Refresh the snapshot when deliberately updating compatibility. Tests validate actual
projections with draft 2020-12 JSON Schema through the development dependency Ajv;
production does not depend on Ajv or a sibling repository.

## Implemented interface

| Area | Navigator behavior |
| --- | --- |
| `state` | Full text and `{view, glossary}` structured content in a game; `STATUS no game` with screen guidance otherwise. |
| `step` | `decision`, integer `indices`, optional `expect`, `timeout_s`; answers then waits. Ordered indices are translated from shared top-first order to the client's bottom-first order. |
| `wait` | Waits without a caller answer; defaults to 60 seconds, accepts through 300. Both wait tools retain automatic forced answers and their `AUTO` lines. |
| `cards` | Text and structured `{glossary}` keyed by card name; `set` replaces internal `expansion`; latest observed costs when available. |
| `log` | Oldest first, original client log indices as `seq`; `after` is exclusive, `limit` keeps the newest entries (default 50, maximum 2000). Structured `{log}` accompanies the text. |
| `new_game` | `kingdom`, `landscapes`, `bots`, `players`; returns a full view. Supports one account and 1–3 bot opponents; total seats must equal bots + 1. Required cards/landscapes need one bot. Other agent seats cannot be reserved. |
| Optional lifecycle | `resign` remains available outside an overlay handoff. `join_game` and `list_games` are not implemented: Navigator does not host games or issue seat tokens. |
| Token arguments | Common `state`, `step`, `wait`, `resign` accept and ignore hosted seat `token`, as allowed for single-account producers. Navigator's explicit `join` instead finds and binds an overlay handoff token to its tab. |
| Navigator extras | `choose` labels/numbers, optional `reason`, overlay `join`, human `find_match`, debugging `inspect`, browser launcher and take-back controls remain available. Ordered legacy `choose` stays bottom-first. Do not mix `choose` with `indices`. |
| Rejections | Unknown argument names are refused before any handler acts. Illegal/stale choices return MCP errors with `REJECTED` and the current decision; no answer is sent for invalid indices, duplicate choices, mismatched expectations or stale IDs. |
| Handoff protection | `step` and `wait` refuse revoked handoffs. Joined sessions cannot start/matchmake/resign games. Advice prompts allow only `join`, then `state`/`cards`/`log`; `wait` is excluded because it may auto-answer. |

`expect` accepts the option's label (with or without a trailing parenthetical) or card
name, ignoring case, spacing and punctuation. Navigator additionally accepts its group
prefix, such as `buy:Silver`. Prefer full labels when the same card can be played or
bought. Each common answer is checked against a fresh view before it is sent.

## Projection and remaining differences

Game-bearing successful results always carry a full shared view, even when their text
is a delta or finished-game summary. The internal tracker and page API stay at
`dominion-navigator/agent-view@1`. The projection uses only that player-visible view
and the public log, never `inspect` or hidden browser objects.

- Game `number` becomes `game.id`; seat/active player indices are recovered from the
  visible player list. Player `points` becomes `vp`, results include seat indices when names map unambiguously to visible seats,
  opponents rotate into turn order starting to the seat's left, trash becomes a zone,
  split-pile `others` becomes `members`, and a pile's Trait becomes `traits`.
- Zone knowledge, unknown cards, owned cards, uncertainty groups and unlocated cards
  are retained as tracked. This adds no perfect-recall capabilities to the existing
  tracker. Tracking lag is still reported in text. Reloads, joining late and unsupported
  card effects may leave information unavailable; schema validity does not prove full
  gameplay or knowledge conformance.
- Decisions include `purpose`, `ordered`, `nameAny`, groups and options with `action`.
  Known buy/play/end-phase/name/number/trigger/mode semantics are mapped; otherwise
  `purpose: other` and `action: select` avoid inventing meaning. Unknown source cards,
  zones and mode positions are omitted. Alternative group combinations are explained
  in each group's prompt because the shared schema has no `alternatives` field.
- **`nameAny` is always false.** The current client bridge supports only its listed
  name choices. Answer those with indices; arbitrary `name` answers are rejected with
  the current decision. This does not claim arbitrary-card naming support.
- Log entries use `type: message` with original text and `seq`; semantic event kinds,
  actors and card names are not guessed from prose. Structured `sinceLastDecision`
  retains all public entries after this MCP session's last explicit answer, across
  repeated waits/states; before its first answer it contains the available game log.
  Automatic forced answers do not advance that explicit-answer cursor. Browser log
  reconstruction can reset indices and the cursor; stable history across reloads and
  undo is not guaranteed by the browser backend.
- Automatic answering retains Navigator’s conservative scope: one mandatory option
  in one group, at most 25 per call. Other uniquely forced decisions are still shown
  to the caller.
- Phase remains derived from Action/Buy decisions and may be `null`. Player counters
  retain their client names; specialized token fields, controller, lasting effects,
  extra-turn queues, Boon/Hex decks, Artifact holders, landscape ownership/counters,
  pile structures and guaranteed initial split-pile membership are not projected.
  Public expansion notes and treasure-in-hand estimates remain in ergonomic text,
  not invented shared fields. The client's extra-turn label is retained as observed.
- Text remains Navigator's rendering rather than the exact canonical shared rendering:
  group headings, `CHOSE`, treasure estimates, expansion notes and opponent-turn
  summaries remain. Full views have a `STATUS` line; deltas keep the `GAME` line.
  Finished `state` text is a summary, while its structured content is a full view.
  Long delta logs are truncated in text with a `log` pointer, never in structured
  `sinceLastDecision`. Non-basic card text is introduced once per game in `CARDS`;
  structured glossaries include all names in the view. Missing catalog text/costs
  remain unavailable rather than being synthesized.

The shared schema tests cover recorded live fixtures, ordered translation, uncertainty,
structured transport, lifecycle responses, stale/illegal answer protection, log cursor
behavior, and launcher/advice safeguards. They do not require a live browser or game.
