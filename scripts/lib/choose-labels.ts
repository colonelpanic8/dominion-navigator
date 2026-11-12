import type { Decision, DecisionOption } from "../../src/agent/types";

/** An option as a label can name it: its group kind, its label, and its number. */
function named(decision: Decision, option: DecisionOption): string {
  return `${decision.groups[option.group]?.kind ?? "?"}:${option.label} (${option.index})`;
}

/** Same-labelled options that differ only in which copy they are, so any of them will do. */
function sameChoice(a: DecisionOption, b: DecisionOption): boolean {
  return a.group === b.group && a.kind === b.kind && a.card === b.card;
}

/**
 * Turns `choose` entries into option numbers. A number is taken as is; a string
 * names an option by its label, without case, optionally prefixed by its group
 * kind as in "buy:Silver". Each label entry takes a further option with that
 * label, so ["Copper", "Copper"] takes two. Throws, naming the candidates, when
 * a label matches nothing left or options that are not interchangeable.
 */
export function resolveChoose(decision: Decision, choose: Array<number | string>): number[] {
  const taken = new Set(choose.filter((entry): entry is number => typeof entry === "number"));
  const kinds = new Set(decision.groups.map((group) => group.kind.toLowerCase()));
  return choose.map((entry) => {
    if (typeof entry === "number") return entry;
    const colon = entry.indexOf(":");
    const prefix = colon > 0 ? entry.slice(0, colon).trim().toLowerCase() : "";
    const kind = kinds.has(prefix) ? prefix : undefined;
    const label = (kind ? entry.slice(colon + 1) : entry).trim().toLowerCase();
    const matches = decision.options.filter(
      (option) => option.label.toLowerCase() === label && (!kind || decision.groups[option.group]?.kind.toLowerCase() === kind)
    );
    const free = matches.filter((option) => !taken.has(option.index));
    const [first] = free;
    if (!first) {
      const list = (matches.length ? matches : decision.options).map((option) => named(decision, option)).join(", ");
      throw new Error(
        matches.length
          ? `"${entry}" names ${matches.length} option(s) of ${decision.id}, and all are already chosen: ${list}.`
          : `"${entry}" names no option of ${decision.id}. Options: ${list}.`
      );
    }
    if (free.some((option) => !sameChoice(option, first))) {
      throw new Error(
        `"${entry}" is ambiguous in ${decision.id}: ${free.map((option) => named(decision, option)).join(", ")}. Prefix the label with its group kind, e.g. "${named(decision, first).replace(/ \(\d+\)$/, "")}", or pass the number.`
      );
    }
    taken.add(first.index);
    return first.index;
  });
}
