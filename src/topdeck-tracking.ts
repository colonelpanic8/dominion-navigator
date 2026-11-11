import { cardNamesForMove, samePlayerIdentity } from "./knowledge";
import { CardMoveSummary, PlayerSummary } from "./messages";

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

const MAX_PENDING_TOPDECKS = 12;
const TOPDECK_LOG_WINDOW_MS = 5000;

type PendingTopdeck = {
  owner: PlayerSummary | undefined;
  count: number;
  capturedAtMs: number;
};

/** Anonymous topdeck moves waiting for the matching "X topdecks Y" log line. */
export class AnonymousTopdeckQueue {
  private readonly pending: PendingTopdeck[] = [];

  record(move: CardMoveSummary, now = Date.now()): void {
    if (!shouldResolveTopdeckFromLog(move)) return;
    this.pending.push({ owner: move.to?.owner, count: move.cardIdsAfterMoving.length, capturedAtMs: now });
    while (this.pending.length > MAX_PENDING_TOPDECKS) this.pending.shift();
  }

  /** Consumes `count` pending cards for `player`, or nothing if fewer are pending. */
  consume(player: PlayerSummary, count: number, now = Date.now()): boolean {
    while (this.pending.length > 0 && now - this.pending[0]!.capturedAtMs > TOPDECK_LOG_WINDOW_MS) {
      this.pending.shift();
    }

    let available = 0;
    for (const item of this.pending) {
      if (!samePlayerIdentity(item.owner, player)) continue;
      available += item.count;
      if (available >= count) break;
    }
    if (available < count) return false;

    let remaining = count;
    for (let index = 0; index < this.pending.length && remaining > 0; index += 1) {
      const item = this.pending[index]!;
      if (!samePlayerIdentity(item.owner, player)) continue;
      const consumed = Math.min(item.count, remaining);
      item.count -= consumed;
      remaining -= consumed;
      if (item.count === 0) {
        this.pending.splice(index, 1);
        index -= 1;
      }
    }
    return true;
  }
}
