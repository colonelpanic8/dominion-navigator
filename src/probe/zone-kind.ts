export type NeutralZoneKind = "supply" | "landscape" | "non-supply" | "trash";

/**
 * Where a neutral zone belongs on the table, given a test for the client classes
 * it is an instance of. `SupplyZone` is a base class of every pile, including
 * landscapes and non-supply piles such as Wish and Imp.
 */
export function neutralZoneKind(isA: (className: string) => boolean): NeutralZoneKind | undefined {
  if (isA("TrashZone")) return "trash";
  if (isA("SingleLandscapeZone") || isA("ReducedLandscapeZone")) return "landscape";
  if (isA("NonSupplyZone")) return "non-supply";
  if (isA("SupplyZone")) return "supply";
  return undefined;
}
