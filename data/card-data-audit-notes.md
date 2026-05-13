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

## Running Behavior Verification Ledger

Use this section as the quick source of truth before choosing the next card to test. "Browser verified" means the behavior was exercised in a live Dominion Online game with the navigator overlay/event stream inspected. "Regression covered" means a focused tracker test was added or already exists for the observed movement pattern.

### Browser Verified

| Card / combo | Game | Behavior checked | Tracker result | Regression covered |
| --- | --- | --- | --- | --- |
| Necromancer + Zombie Apprentice | `#178442728` | Played a face-up Action from the trash while leaving it there. Dominion did not emit a `TrashZone -> InPlayZone` move for the Zombie. | Hero ownership stayed at `7 Copper, 3 Estate, 1 Necromancer`; Zombie did not enter owned ledger. | Yes, synthetic equivalent. |
| Bandit | `#178429682` | Gained Gold; opponent revealed Copper/Smithy, then discarded them with one after-move identity anonymized. | Preserved before-move identities for reveal-to-discard. | Yes. |
| Bureaucrat | `#178429682` | Gained Silver onto hero deck with after-move identity anonymized; opponent topdecked Estate from hand. | Kept Silver identity on hero deck; did not infer opponent anonymous topdeck identity from movement alone. | Yes. |
| Sentry | `#178429682` | Revealed Copper/Silver, then topdecked them with after-move identities anonymized. | Kept known topdeck identities through anonymous draw-pile snapshot. | Yes. |
| Ambassador | `#178441615` | Revealed Copper, returned 2 Coppers to Supply, opponent gained separate Copper. | Removed returned Coppers from hero ownership and added opponent-gained Copper separately. | Yes. |
| Lurker + Fortress | `#178448747` | Lurker trashed Fortress from Supply; Fortress replacement put it into hero hand. | Hero ended with `2 Fortress` in `HandZone`; recent moves showed `SetAsideZone -> TrashZone -> HandZone`. | No dedicated test; browser behavior looked correct. |
| Messenger | `#178449122` | Played Messenger and chose `Discard` for `put your deck into your discard pile`. | Hero `DrawZone` became empty and `DiscardZone` kept the known identities `3 Copper, 2 Estate, 1 Experiment, 1 Native Village`. | Yes. |
| Experiment | `#178449122` | Bought one Experiment, gained the paired copy, then played Experiment and returned it to its pile. | Owned ledger moved from `2 Experiment` to `1 Experiment`; recent move showed `Experiment · your InPlayZone -> SetAsideZone`. | No dedicated return-to-pile test yet. |
| Band Of Misfits + Bounty Hunter | `#178449122` | Played `Band Of Misfits`, chose Supply `Bounty Hunter`, then exiled an Estate from hand. | Supply `Bounty Hunter` did not enter play or add to hero ownership; Estate moved `HandZone -> ExileZone` while total known owned stayed stable. | No dedicated test; browser behavior looked correct. |
| Band Of Misfits + Island | `#178449122` | Played `Band Of Misfits`, chose Supply `Island`, then put an Estate on the Island mat. | Dominion left `Band Of Misfits` in play and moved only the chosen Estate to `IslandZone`; tracker did not add an extra Supply Island. | No dedicated test; browser behavior looked correct. |
| Band Of Misfits + Duplicate | `#178449122` | Played `Band Of Misfits`, chose Supply `Duplicate`, then continued to buy phase. | Dominion logged `plays a Duplicate` but no Supply Duplicate moved to `TavernZone`; tracker kept only Band in play and did not add extra Duplicate ownership. | No dedicated test; browser behavior looked correct. |
| Native Village pickup | `#178449122` | Played Native Village and chose `Pick Up` after a prior set-aside. | Estate moved from `NVZone` to hand and `NVZone` became empty. | No dedicated test; browser behavior looked correct. |
| Native Village + Stockpile | `#178449122` | Played Native Village and chose `Set Aside` with Stockpile on top of the deck. | Tracker preserved `Stockpile` identity on `NVZone`; the separate played Stockpile self-exile was verified later in the same game. | No dedicated test; browser behavior looked correct. |
| Island | `#178449122` | Played owned Island, then set aside an Estate from hand. | Tracker moved the played Island and selected Estate to `IslandZone`, resulting in `2 Estate, 1 Island` there. | No dedicated test; browser behavior looked correct. |
| Masquerade | `#178449122` | Opponent played Masquerade; hero passed Copper and received Estate; opponent then trashed an Estate. | Hero known ownership shifted to `6 Copper, 4 Estate`; opponent gained the Copper and lost the trashed Estate. | No dedicated test; browser behavior looked correct. |
| Cargo Ship + Stockpile | `#178449122` | Played Cargo Ship, bought Stockpile, chose the Cargo Ship set-aside, then observed next-turn hand placement. | Gained Stockpile moved through Cargo Ship set-aside and appeared in hand at start of next turn; tracker kept identity through the delayed zone. | No dedicated test; browser behavior looked correct. |
| Stockpile | `#178449122` | Played a Stockpile that had entered hand from Cargo Ship. | Tracker showed `Stockpile · HandZone -> InPlayZone -> ExileZone`; ExileZone contained `Copper, Estate, Stockpile`, while the other Stockpile stayed on `NVZone`. | No dedicated test; browser behavior looked correct. |
| Duplicate + Exile discard | `#178449122` | Played owned Duplicate to Tavern, bought Estate, called Duplicate to gain a second Estate, then discarded matching Estate from Exile. | Duplicate moved `HandZone -> TavernZone -> InPlayZone` and left Tavern after cleanup; Estate ownership increased from the Duplicate gain, and ExileZone lost the discarded Estate. | No dedicated test; browser behavior looked correct. |

### Synthetic Regression Covered, Browser Pending

| Card / combo | Behavior covered | Remaining work |
| --- | --- | --- |
| Messenger | `put your deck into your discard pile` should preserve known draw-pile identities when the following discard snapshot is only partial/top-card-only. | Live browser verification completed in `#178449122`; keep regression. |

### Partial / Setup Only

| Card | Evidence | Remaining work |
| --- | --- | --- |
| Vassal | Bought successfully in custom kingdom; supply count dropped. | Need play-effect verification. |
| Advisor, Alchemist, Apothecary, Archive, Armory, Artificer, Artisan, Harbinger, Mine | Included in early custom kingdoms or audit setup. | Need actual effect playthroughs and tracker checks. |

### High-Risk Still Worth Prioritizing

- Play-from-Supply Command cards: `Band Of Misfits`, `Overlord`, `Captain`.
- Whole-deck-to-discard transfers: `Messenger`, `Bad Omens`, `Herb Gatherer`, `Scavenger`, `Trusty Steed`.
- Persistent nonstandard zones: `Island`, `Native Village`, Reserve/Tavern cards.
- Exile: `Bounty Hunter`, `Coven`, `Transport`, `Stockpile`.
- Gain-and-play / gain-to-non-discard: `Innovation`, `Continue`, `Summon`, `Cargo Ship`, `Blockade`.
- Player-to-player transfer: `Masquerade`.
- Possession/control: `Possession`.

### Stress Kingdom 1

Game `#178449122` uses a deliberately difficult ten-card kingdom:

```text
Masquerade, Messenger, Native Village, Island, Bounty Hunter, Stockpile, Duplicate, Band Of Misfits, Experiment, Cargo Ship
```

Coverage intent:

- `Masquerade`: direct player-to-player card transfer plus optional trash.
- `Messenger`: whole draw pile to discard; first-gain distributes a matching card to every player.
- `Native Village`: face-down persistent mat, later moving all mat cards into hand.
- `Island`: persistent mat that removes itself and another card from the deck.
- `Bounty Hunter`: Exile from hand.
- `Stockpile`: Treasure that exiles itself from play.
- `Duplicate`: Reserve/Tavern mat, then called on a gain to create another gain.
- `Band Of Misfits`: plays a Supply card while leaving it there.
- `Experiment`: gain-chain plus return-to-pile on play.
- `Cargo Ship`: gain-to-set-aside, then next-turn hand.

Initial observations:

- Turn 1: buying `Experiment` gained the second `Experiment`; tracker showed `2 Experiment` in hero ownership/discard.
- Turn 2: buying `Messenger` opened the distribute prompt; choosing `Native Village` correctly added one `Native Village` to each player's owned ledger.
- Turn 3: playing `Experiment` drew two Coppers, then returned `Experiment` to the pile; tracker removed one Experiment from hero ownership.
- Turn 3: playing `Messenger` and choosing `Discard` moved the deck into discard; tracker preserved the known draw identities in `DiscardZone`.
- Turn 5: `Band Of Misfits` played Supply `Bounty Hunter`; the Supply card was not counted as owned or shown in play, while the Estate selected for Bounty Hunter moved to `ExileZone`.
- Turn 6: `Band Of Misfits` played Supply `Island`; Dominion left Band in play and moved only the chosen Estate to `IslandZone`, with no extra Supply Island inferred.
- Turn 7: Native Village `Pick Up` moved the set-aside Estate into hand and emptied `NVZone`.
- Turn 7: owned `Island` moved itself plus an Estate onto `IslandZone`; tracker showed `2 Estate, 1 Island` there.
- Turn 7/8: opponent `Masquerade` passed Estate to hero, hero passed Copper, and opponent trashed an Estate; tracker reflected the cross-player ownership transfer.
- Turn 7: bought `Stockpile`; Turn 9 Native Village set that Stockpile aside onto `NVZone`, preserving the card identity.
- Turn 8: bought `Cargo Ship`; Turn 11 Cargo Ship set aside a gained Stockpile, and Turn 12 put it into hand.
- Turn 9: bought `Duplicate`; Turn 13 played a real Duplicate to Tavern, called it on an Estate gain, and gained a copied Estate.
- Turn 10: `Band Of Misfits` played Supply `Duplicate`; Dominion logged the Duplicate play but did not move a Duplicate to `TavernZone` or add extra Duplicate ownership.
- Turn 12: played Stockpile from hand; tracker showed `HandZone -> InPlayZone -> ExileZone`, while the separate Native Village Stockpile remained on `NVZone`.
- Turn 13: after buying Estate and calling Duplicate, the matching Estate in Exile could be discarded; tracker removed it from `ExileZone` and retained the copied Estate gain.

### Candidate Stress Kingdom 2

The next highest-risk cluster should move away from the mechanics already covered by Stress Kingdom 1 and target unverified effects that can change card ownership, play cards from unusual locations, or keep cards out of ordinary cleanup for multiple turns:

```text
Possession, Black Market, Prince, Crypt, Gear, Church, Cage, Graverobber, Trader, Changeling
```

Add these landscapes if the table editor accepts them alongside the ten piles:

```text
Inheritance, Innovation, Continue, Rapid Expansion, March, Way of the Turtle
```

Coverage intent:

- `Possession`: controlled extra turn where gains go to the possessor and trashed cards are set aside before returning to the possessed player's discard.
- `Black Market`: reveal and buy from a non-Supply Black Market deck, then bottom-deck the unbought revealed cards.
- `Prince`: set aside an owned Action and replay it from set-aside at the start of each turn.
- `Crypt`, `Gear`, `Church`, `Cage`: delayed face-down set-aside under/near a card, then later hand return or trash-trigger return.
- `Graverobber`: gain from trash onto deck, plus trash-from-hand-and-gain replacement.
- `Trader`, `Changeling`: exchange / ownership-transform effects when gaining or trashing.
- `Inheritance`, `Innovation`, `Continue`, `Rapid Expansion`, `March`, `Way of the Turtle`: play-from-non-hand and gain-and-play cases that are not covered by Band Of Misfits or Necromancer.

## Tracker Risk Hunt

The behavior-review backlog is much larger than the early gameplay sample: `trackerAudit.behaviorReview.behaviorCheckKeys` currently contains 366 `must-check` keys out of 806 tracker candidates.

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

Verified follow-up: from the score screen after game `#178442728`, clicking `Edit Table` and then `Select Kingdom Cards` exposed both controllers above. Clearing the kingdom in one CDP evaluation, waiting for the table text to show no fixed kingdom code, and then adding a replacement list in a second evaluation successfully updated the visible kingdom code. Clicking `Ready` created game `#178444050`.

If the new game reaches `Waiting for colonelpanic8` with no visible `Start Game` button, send the start confirmation directly:

```js
const serverMessenger = angular.element(document.body).injector().get("serverMessenger");
serverMessenger.answerQuestion({ questionIndex: 0, list: [] });
```

In game `#178444050`, that advanced the log from setup to `c shuffles their deck.`, `c draws 3 Coppers and 2 Estates.`, and `Turn 1 - colonelpanic8`. If the old score/table pane remains visually stuck as `.score-page.ng-leave`, removing that stale leaving node from the DOM clears the browser view without affecting the running game.

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
