# Dominion Card Data Audit Notes

`dominion-card-shaped-objects.json` is the single machine-readable card data artifact for this project.

It contains:

- Raw card-shaped objects extracted from the Dominion Online client.
- `trackerAudit`, a generated audit layer for card-location tracking work.
- `trackerAudit.behaviorReview`, a judgment pass over the tracker candidates.

The audit started from 952 extracted card-shaped objects. The tracker candidate pass flagged 806 objects with text or type patterns relevant to card ownership, card movement, location knowledge, or missing extracted text.

Those 806 candidates were then read in batches and classified into:

- `must-check`: likely needs explicit in-game verification for the tracker.
- `watch`: probably covered by generic card-move tracking, but worth regression awareness.
- `normal`: no special tracker behavior identified beyond ordinary draw, economy, gain, trash, or discard handling.

The current behavior-review shortlist is stored at:

```text
trackerAudit.behaviorReview.behaviorCheckKeys
```

Useful lookup fields:

- `trackerAudit.behaviorReview.reviewByCardKey`
- `trackerAudit.behaviorReview.behaviorReviewKeysByReason`
- `trackerAudit.auditByCardKey`
- `trackerAudit.candidateAuditByCardKey`

The audit generator is `scripts/audit-card-tracker-candidates.mjs`. By default it rewrites `data/dominion-card-shaped-objects.json` in place, keeping this as a single data artifact.

## Gameplay Audit Notes

Date: 2026-05-12.

Purpose: establish a repeatable way to start bot games, restart from the same table, set specific kingdom cards, and begin checking the cards marked `must-check` in `trackerAudit.behaviorReview`.

## Tracker Risk Hunt

The behavior-review backlog is much larger than the early gameplay sample: `trackerAudit.behaviorReview.behaviorCheckKeys` currently contains 364 `must-check` keys out of 806 tracker candidates.

The most suspicious current tracker assumption is in ownership handling for moves from unowned zones into player-controlled zones. `DeckKnowledgeTracker.applyMove` treats any move from a non-player-owned zone into a player-owned zone as a gain and adds the moved card to that player's owned-card ledger. That is correct for normal gains, but likely wrong for effects that play a card from the trash or Supply while explicitly leaving it there.

High-risk `must-check` bucket:

```text
trackerAudit.behaviorReview.behaviorReviewKeysByReason["play-from-non-hand-or-unowned-card"]
```

Likely affected examples:

- `NECROMANCER`: plays a face-up Action from the trash, leaving it there.
- `BAND_OF_MISFITS`, `OVERLORD`, `CAPTAIN`: play a non-Duration Action from the Supply, leaving it there.
- `RIVERBOAT`, `WAY_OF_THE_MOUSE`, `INHERITANCE`: play a set-aside Supply card while leaving it set aside.

Synthetic tracker break:

1. Start with the hero owning only `Necromancer` in `InPlayZone`.
2. Apply a card-move from unowned `TrashZone` to hero `InPlayZone` for `Zombie Apprentice`.
3. The current summary reports:

```json
{
  "totalKnownOwned": {
    "Necromancer": 1,
    "Zombie Apprentice": 1
  }
}
```

That is probably wrong for Dominion deck ownership: the Zombie is controlled/in play for the turn, but was not gained and should not enter the player's owned deck. A correct fix probably needs to distinguish cards controlled in a player zone from cards actually owned by that player. A simple "never add unowned -> InPlayZone" rule would avoid Necromancer, but could undercount true gain-and-play effects such as `INNOVATION`, `CONTINUE`, `INVASION`, `MINING_ROAD`, `RUSH`, or `SAILOR`.

Browser follow-up in game `#178442728`: after the hero played `Necromancer` and chose `Zombie Apprentice`, Dominion Online logged `c plays a Zombie Apprentice.` but did not emit a `TrashZone -> InPlayZone` card move for the Zombie. The Zombie stayed in the neutral trash zone in the client model, so the live overlay continued to show the hero owning only `7 Copper, 3 Estate, 1 Necromancer` and the hero `InPlayZone` containing only `Necromancer`. The synthetic regression still guards the tracker against equivalent client events from other play-from-unowned-source cards.

### Starting and Restarting Bot Games

Observed working flow from the Dominion Online lobby:

1. Log in.
2. Click `New Table`. The tab changes to `My Table`.
3. In `Players (1/2)`, click the add-bot icon in the empty slot. The bot joins as `Lord Rattington`.
4. Click `Ready` to start a game.
5. To end the game, click the game tab `Resign`, confirm `Resign?` with `Yes`, then dismiss the game-ended dialog with `Ok`.
6. The score/table view remains attached to the same table with the bot still seated.
7. Click `Ready` again to start a fresh game from the same table.

This was verified by starting game `#178427826`, resigning it, dismissing the end-game modal, and clicking `Ready` again to start game `#178427999` with the same bot seat.

### Setting Custom Kingdom Cards

Observed working UI flow after a game has ended:

1. Click `Edit Table`.
2. Click `Select Kingdom Cards`.
3. Use search/selection to fill the kingdom, or use the Angular table controllers from a CDP session for repeatability.
4. Click `Ready` to start a game with the selected kingdom.

Controller-assisted setup, useful for repeatable audits:

```js
const kr = angular.element(document.querySelector("KINGDOM-RULES")).data().$kingdomRulesController;
const selector = angular.element(document.querySelector("TABLE-CARD-SELECTOR")).data().$tableCardSelectorController;
const root = angular.element(document.body).injector().get("$rootScope");

kr.clearKingdom();
root.$applyAsync();

for (const name of [
  "Advisor",
  "Alchemist",
  "Ambassador",
  "Apothecary",
  "Archive",
  "Armory",
  "Artificer",
  "Artisan",
  "Bandit",
  "Bureaucrat"
]) {
  selector.searchString = name;
  selector.updateSearchString();
  const card = selector.rawSearchObjects.find((object) => object.name === name);
  selector.addCard(card);
}

root.$applyAsync();
```

When replacing an existing fixed kingdom, call `kr.clearKingdom()` as its own CDP step and wait for the table to show no fixed kingdom cards before adding the replacement list. Combining clear and add in the same evaluation can race the server rule update and leave some of the old fixed cards in place.

After this setup, the table kingdom code was:

```text
apothecary, ambassador, alchemist, advisor, armory, bureaucrat, archive, artificer, bandit, artisan
```

### Initial `must-check` Card Test

The first custom kingdom was chosen from early `must-check` entries that were searchable in the Dominion Online selector:

- Advisor
- Alchemist
- Ambassador
- Apothecary
- Archive
- Armory
- Artificer
- Artisan
- Bandit
- Bureaucrat

Game `#178428383` started successfully with those ten kingdom piles, plus Potion. The visible supply contained:

```text
Advisor, Alchemist, Ambassador, Apothecary, Archive, Armory, Artificer, Artisan, Bandit, Bureaucrat
```

The navigator overlay initialized on that game and observed both starting decks:

```text
colonelpanic8: 7 Copper, 3 Estate
Lord Rattington: 7 Copper, 3 Estate
```

That confirms the current tracker can attach to a custom-kingdom bot game and recover the initial known-card model for both players.

### Second Custom-Kingdom Attempt

To check whether the first loading problem was caused by the mixed/deprecated/Alchemy kingdom, a Base-only kingdom was also started from cards marked `must-check`:

- Artisan
- Bandit
- Bureaucrat
- Harbinger
- Mine
- Sentry
- Vassal

Simple Base fillers were added to make a ten-card kingdom:

- Cellar
- Village
- Smithy

The table kingdom code was:

```text
cellar, harbinger, vassal, village, bureaucrat, smithy, bandit, mine, sentry, artisan
```

Game `#178428799` started with that supply. The first pass appeared stuck because the DOM still reported `Loading game...`, `Your starting cards:`, and no normal DOM turn controls. Further inspection showed that Dominion had rendered a canvas-backed `Start Game` button through `game.questionModel.gameButtons`.

### Canvas Controls for Playthroughs

Useful controller/canvas interactions discovered while testing game `#178428799`:

```js
const game = window.__dominionNavigator.game;

// Prefer this before starting test games. Dominion labels AnimationOptions.INSTANT as "None".
game.optionsWindow.animationType = 5;
game.optionsModel.setAnimations(5);

// Dismiss the "Your starting cards" prompt.
game.questionModel.gameButtons.find((button) => button.text === "Start Game").onClick();

// Play treasures once the buy phase is active.
game.questionModel.gameButtons.find((button) => button.text === "Autoplay Treasures").onClick();

// Buy a supply pile by invoking the card stack view click handler.
// In the Base-only test kingdom, zone 13 was Vassal.
game.state.zones[13].cardStacks[0].view.onclick();
```

After reloading the extension with the non-blocking card-move hook, this path reached `Turn 1 - colonelpanic8`, clicked `Autoplay Treasures`, and bought Vassal. The Dominion log confirmed:

```text
c plays 4 Coppers. (+$4)
c buys and gains a Vassal.
```

The Vassal supply count dropped from 10 to 9. This is the first successful purchase of a `must-check` card in the audit kingdom.

After setting animations to `None`, resigning, and restarting from the same table, game `#178429682` reached `Turn 1 - colonelpanic8` cleanly with no animation queue backlog. The visible game buttons were `Autoplay Treasures` and `End Buys`, confirming this is the preferred setup for future card-effect playthroughs.

### Bandit Effect Check

In game `#178429682`, the first automated playthrough bought Cellar, Bandit, and Bureaucrat, then drew Bandit on turn 4. Playing Bandit succeeded with a synthetic canvas event that included `offsetX` and `offsetY`.

The Dominion log confirmed the relevant card-location behavior:

```text
c plays a Bandit.
c gains a Gold.
L reveals a Copper and a Smithy.
L discards a Copper and a Smithy.
```

The probe event stream captured the important tracker edge case:

- Bandit moved from `HandZone` to `InPlayZone`.
- Gold moved from `SetAsideZone` to `DiscardZone`.
- The opponent's Copper and Smithy moved from `DrawZone` to `RevealZone`.
- The same Copper and Smithy moved from `RevealZone` to `DiscardZone`, but Dominion anonymized the Copper in `cardsAfterMoving`.

This is covered by the tracker fallback that preserves before-move identities for player-owned moves when after-move identities are less specific. A regression test now covers this Bandit reveal-to-discard pattern.

### Bureaucrat Effect Check

In the same game, Bureaucrat was bought on turn 3 and drawn on turn 5. Playing Bureaucrat succeeded with the same synthetic canvas event path used for Bandit.

The Dominion log confirmed the relevant card-location behavior:

```text
c plays a Bureaucrat.
c gains a Silver.
L topdecks an Estate.
```

The probe event stream captured two important tracker cases:

- Bureaucrat moved from `HandZone` to `InPlayZone`.
- Silver moved from `SetAsideZone` to the hero `DrawZone`, with `cards: ["Silver"]` but `cardsAfterMoving: ["Anonymous"]`. The tracker should keep the before-move `Silver` identity and add it to the hero's known owned cards on top of the deck.
- The opponent's topdeck event moved an `Anonymous` card from the opponent `HandZone` to the opponent `DrawZone`. The page log text revealed it was an Estate, but the card-move event itself did not, so the tracker should not infer the identity from this movement.

A regression test now covers the Silver gain-to-deck pattern where Dominion anonymizes the card after it enters the draw pile.

### Sentry Effect Check

In game `#178429682`, Sentry was bought on turns 6 and 7, then drawn and played on turn 9. The Sentry prompt was advanced by clicking `Confirm Trashing`, `Confirm Discarding`, and `Done Ordering` without selecting either revealed card.

The Dominion log confirmed the relevant card-location behavior:

```text
c plays a Sentry.
c draws a Copper.
c gets +1 Action.
c looks at a Copper and a Silver.
c topdecks a Copper and a Silver.
```

The probe event stream captured the important tracker sequence:

- Sentry moved from `HandZone` to `InPlayZone`.
- Copper moved from the hero `DrawZone` to `HandZone` for Sentry's `+1 Card`.
- Silver and Copper moved from the hero `DrawZone` to a temporary hero `RevealZone`.
- The same Silver and Copper moved from that `RevealZone` back to the hero `DrawZone`, but Dominion reported `cardsAfterMoving: ["Anonymous", "Anonymous"]` after they were topdecked.
- The follow-up snapshot also represented the draw pile as anonymous, so snapshot reconciliation must not erase the known topdeck identities learned from the card-move event.

A regression test now covers the Sentry reveal-to-topdeck pattern and the anonymous draw-pile snapshot that follows it.

### Ambassador Effect Check

After clearing the previous fixed kingdom and waiting for the table update, game `#178441615` started with this kingdom:

```text
cellar, moat, ambassador, village, workshop, militia, smithy, festival, laboratory, market
```

Lord Rattington bought Ambassador on turn 1, and the hero bought Ambassador on turn 1 with a five-Copper opening hand. The hero drew and played Ambassador on turn 4.

The Dominion log confirmed the relevant card-location behavior:

```text
c plays an Ambassador.
c reveals a Copper.
c returns 2 Coppers to the Copper pile.
L gains a Copper.
```

The probe event stream captured the important tracker sequence:

- Ambassador moved from the hero `HandZone` to `InPlayZone`.
- The selected Copper briefly moved from hero `HandZone` to a hero `SkippableRevealZone`, then back to `HandZone` before the return-count choice.
- Two Coppers moved from the hero `HandZone` to the Copper `SetAsideZone`, representing cards returned to the supply and removed from hero ownership.
- One Copper moved from the Copper `SetAsideZone` to Lord Rattington's `DiscardZone`, representing the attack gain for the single opponent.

A regression test now covers the ownership split where returned cards leave the hero's owned deck while the opponent gains a separate known copy.

### Current Testing Limitation

The debug browser processes Dominion animations slowly unless the Dominion animation option is set to `None`. Forced queue draining can still hit Dominion client's own `anonymousCards` exception while unwinding startup/cleanup animations. A probe-side guard was added so navigator summaries cannot prevent Dominion's animation callback from running, but forced queue draining should be treated as a recovery/debug tactic rather than clean gameplay evidence.

Because of that, this session started custom-kingdom tests and successfully exercised Bandit's reveal/gain/discard behavior, Bureaucrat's gain-to-deck/topdeck behavior, Sentry's reveal/topdeck behavior, and Ambassador's reveal/return/gain behavior, but did not complete per-card effect verification for Advisor, Alchemist, Apothecary, Archive, Armory, Artificer, Artisan, Harbinger, Mine, or Vassal.

Next useful step: stabilize turn entry in the Dominion client, then play through the custom kingdom and record tracker observations for each card effect that moves, reveals, gains, trashes, exiles, sets aside, or otherwise changes card-location knowledge.
