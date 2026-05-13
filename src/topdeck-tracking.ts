import { cardNamesForMove } from "./knowledge";
import { CardMoveSummary, PlayerSummary, ZoneSummary } from "./messages";

export function samePlayerIdentity(a: ZoneSummary["owner"] | undefined, b: PlayerSummary | undefined): boolean {
  if (!a || !b) return false;
  if (a.index !== undefined && b.index !== undefined) return a.index === b.index;
  return a.name !== undefined && a.name === b.name;
}

export function shouldResolveTopdeckFromLog(move: CardMoveSummary): boolean {
  return (
    move.phase === "after" &&
    move.from?.owner?.index !== undefined &&
    move.from.owner.index >= 0 &&
    move.to?.zoneName === "DrawZone" &&
    move.to.owner?.index !== undefined &&
    move.to.owner.index >= 0 &&
    samePlayerIdentity(move.from.owner, move.to.owner) &&
    move.cardIdsAfterMoving.length > 0 &&
    move.cardIdsAfterMoving.every((id) => id === -1) &&
    move.cardsAfterMoving.every((card) => card === "Anonymous") &&
    cardNamesForMove(move).length === 0
  );
}
