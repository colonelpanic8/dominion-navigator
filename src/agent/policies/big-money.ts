import { DecidableView, Policy, PolicyChoice, PolicyContext } from "../policy";
import { DecisionGroup, DecisionOption } from "../types";

export type BigMoneyOptions = {
  /** An optional terminal Action to buy (at most `maxTerminals` copies) and always play. */
  terminal?: string;
  maxTerminals?: number;
};

type CardFacts = (card: string) => { cost: number; types: string[] };

function cardFacts(view: DecidableView, context: PolicyContext): CardFacts {
  return (card) => {
    const pile = [...view.supply, ...view.nonSupply, ...view.landscapes].find((item) => item.card === card);
    const entry = context.glossary[card];
    return { cost: pile?.cost?.coins ?? entry?.cost?.coins ?? 0, types: pile?.types ?? entry?.types ?? [] };
  };
}

/** Lower is worse to keep: Curses, then pure Victory cards, then Copper, then by cost. */
function keepValue(card: string, facts: CardFacts): number {
  if (card === "Curse") return -2;
  const { cost, types } = facts(card);
  if (types.includes("Victory") && !types.includes("Treasure") && !types.includes("Action")) return -1;
  if (card === "Copper") return 0;
  return cost + (types.includes("Treasure") ? 0.5 : 0);
}

/** Lower is better to trash: only Curses, Estates and Coppers are junk; other cards keep their cost. */
function trashValue(card: string, facts: CardFacts): number {
  if (card === "Curse") return -2;
  if (card === "Estate") return -1;
  if (card === "Copper") return 0;
  return facts(card).cost + 1;
}

function gainValue(card: string, facts: CardFacts): number {
  if (card === "Curse") return -10;
  const { cost, types } = facts(card);
  return cost + (types.includes("Treasure") ? 1 : 0) + (card === "Province" ? 2 : 0);
}

function optionsIn(view: DecidableView, group: DecisionGroup | undefined): DecisionOption[] {
  return group ? view.decision.options.filter((option) => option.group === group.group) : [];
}

function choose(options: DecisionOption[], reason: string): PolicyChoice {
  return { indices: options.map((option) => option.index), reason };
}

/** Picks `count` options, ordered by `score` ascending. */
function pickLowest(options: DecisionOption[], count: number, score: (option: DecisionOption) => number): DecisionOption[] {
  return [...options].sort((a, b) => score(a) - score(b) || a.index - b.index).slice(0, count);
}

export class BigMoneyPolicy implements Policy {
  readonly name: string;
  private readonly terminal: string | undefined;
  private readonly maxTerminals: number;

  constructor(options: BigMoneyOptions = {}) {
    this.terminal = options.terminal;
    this.maxTerminals = options.maxTerminals ?? 1;
    this.name = this.terminal ? `big-money+${this.terminal.toLowerCase()}` : "big-money";
  }

  decide(view: DecidableView, context: PolicyContext): PolicyChoice {
    const facts = cardFacts(view, context);
    const decision = view.decision;
    if (decision.questionId.includes("ACTION_PHASE")) return this.actionPhase(view);
    if (decision.questionId.includes("BUY_PHASE")) return this.buyPhase(view, facts);
    return this.otherDecision(view, facts);
  }

  private actionPhase(view: DecidableView): PolicyChoice {
    const options = view.decision.options;
    const terminal = options.find((option) => option.kind === "card" && option.card === this.terminal);
    if (terminal) return choose([terminal], `play ${terminal.card}`);
    const end = options.find((option) => option.kind === "decline");
    if (end) return choose([end], "no actions to play");
    return this.otherDecision(view, cardFacts(view, { glossary: {} }));
  }

  private buyPhase(view: DecidableView, facts: CardFacts): PolicyChoice {
    const { options, groups } = view.decision;
    const treasure = options.find((option) => option.kind === "card" && option.card && facts(option.card).types.includes("Treasure") && groupKind(groups, option) === "play");
    if (treasure) {
      const autoplay = options.find((option) => option.kind === "button" && /autoplay treasures/i.test(option.label));
      return choose([autoplay ?? treasure], autoplay ? "autoplay treasures" : `play ${treasure.card}`);
    }

    const buyGroup = groups.find((group) => group.kind === "buy");
    const buyable = optionsIn(view, buyGroup).filter((option) => option.kind === "card");
    const coins = view.turn.coins ?? 0;
    const find = (card: string): DecisionOption | undefined => buyable.find((option) => option.card === card);
    const ownedTerminals = this.terminal ? (view.you?.owned.known[this.terminal] ?? 0) : 0;

    const target =
      (coins >= 8 && find("Province")) ||
      (coins >= 6 && find("Gold")) ||
      (this.terminal && ownedTerminals < this.maxTerminals && find(this.terminal)) ||
      (coins >= 3 && find("Silver")) ||
      undefined;
    if (target) return choose([target], `buy ${target.card} with $${coins}`);

    const end = optionsIn(view, buyGroup).find((option) => option.kind === "decline") ?? options.find((option) => option.kind === "decline");
    if (end) return choose([end], `nothing worth buying with $${coins}`);
    return { indices: [], reason: "nothing to buy" };
  }

  private otherDecision(view: DecidableView, facts: CardFacts): PolicyChoice {
    const { options, groups } = view.decision;
    const group = groups.find((item) => item.min > 0) ?? groups[0];
    if (!group) return { indices: [], reason: "no options" };
    const groupOptions = optionsIn(view, group);
    const decline = groupOptions.find((option) => option.kind === "decline");
    const selectable = groupOptions.filter((option) => option.kind !== "decline");
    const cardScore = (option: DecisionOption): number => (option.card ? keepValue(option.card, facts) : 0);

    const exclusive = selectable.find((option) => option.kind === "accept" || option.kind === "keep-order");
    if (exclusive) return choose([exclusive], exclusive.label);
    if (selectable.some((option) => option.kind === "number")) {
      return choose([selectable.find((option) => option.kind === "number")!], "smallest number");
    }

    switch (group.kind) {
      case "discard":
      case "topdeck":
      case "bottomdeck":
      case "set-aside":
      case "return":
        if (group.min === 0) return decline ? choose([decline], `decline to ${group.kind}`) : { indices: [], reason: `${group.kind} nothing` };
        return choose(pickLowest(selectable, group.min, cardScore), `${group.kind} the least useful cards`);
      case "trash":
      case "trash-unique": {
        const junk = selectable.filter((option) => option.card === "Curse" || option.card === "Estate");
        const count = Math.max(group.min, Math.min(group.max, junk.length));
        if (count === 0) return decline ? choose([decline], "keep everything") : { indices: [], reason: "trash nothing" };
        return choose(
          pickLowest(selectable, count, (option) => (option.card ? trashValue(option.card, facts) : 0)),
          "trash the least valuable cards"
        );
      }
      case "gain": {
        const count = Math.max(group.min, 1);
        const best = pickLowest(selectable, count, (option) => -(option.card ? gainValue(option.card, facts) : 0));
        return choose(best, `gain ${best.map((option) => option.label).join(", ")}`);
      }
      default: {
        if (group.min === 0 && decline) return choose([decline], "decline optional choice");
        const count = Math.max(group.min, selectable.length > 0 ? 1 : 0);
        if (count === 0) return decline ? choose([decline], "only option") : { indices: [], reason: "nothing to choose" };
        return choose(selectable.slice(0, Math.min(count, group.max)), "first legal option");
      }
    }
  }
}

function groupKind(groups: DecisionGroup[], option: DecisionOption): string | undefined {
  return groups.find((group) => group.group === option.group)?.kind;
}
