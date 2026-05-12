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

Game `#178428799` started with that supply, but after a 30-second wait it still reported `Loading game...`, `Your starting cards:`, and no visible active turn controls. The `Force end turn` control existed in the DOM but had zero size.

### Current Testing Limitation

The Dominion client did not expose active turn controls after either custom game reached the `Your starting cards:` state. The DOM reported the game id, supply, starting decks, and game tab strip, while screenshots showed the client in a loading state.

Because of that, this session started custom-kingdom tests for the listed `must-check` cards but did not complete per-card playthrough verification for Advisor, Alchemist, Ambassador, Apothecary, Archive, Armory, Artificer, Artisan, Bandit, Bureaucrat, Harbinger, Mine, Sentry, or Vassal.

Next useful step: stabilize turn entry in the Dominion client, then play through the custom kingdom and record tracker observations for each card effect that moves, reveals, gains, trashes, exiles, sets aside, or otherwise changes card-location knowledge.
