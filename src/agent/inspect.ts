// A bounded, JSON-safe dump of live client objects, which are cyclic and full of
// DOM nodes and methods. This reads the client as it is, so unlike the agent view
// it can show more than the player is entitled to know.

export type InspectOptions = {
  /** Levels of nesting to expand below the addressed value. */
  depth?: number;
  /** Array elements, map entries or object keys kept per container. */
  maxEntries?: number;
};

const MAX_DEPTH = 6;
const MAX_ENTRIES = 200;
const MAX_STRING = 200;

function className(value: object): string | undefined {
  const name = (Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null)?.constructor?.name;
  // The client is minified, so one- and two-letter class names carry no information.
  return name && name !== "Object" && name.length > 2 ? name : undefined;
}

function isDomNode(value: object): value is { nodeType: number; nodeName: string } {
  return typeof (value as { nodeType?: unknown }).nodeType === "number" && typeof (value as { nodeName?: unknown }).nodeName === "string";
}

function dataKeys(value: object): string[] {
  return Object.keys(value).filter((key) => typeof (value as Record<string, unknown>)[key] !== "function");
}

/** One-line stand-in for a container that is not expanded. */
function summarize(value: object): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (isDomNode(value)) return `<${value.nodeName.toLowerCase()}>`;
  const name = (value as { name?: unknown }).name;
  const label = className(value) ?? "";
  if (typeof name === "string") return `${label}(${name})`;
  const keys = dataKeys(value);
  return `${label}{${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", …" : ""}}`;
}

function limited<T>(items: T[], maxEntries: number, render: (item: T) => unknown): unknown[] {
  const shown: unknown[] = items.slice(0, maxEntries).map(render);
  if (items.length > maxEntries) shown.push(`… ${items.length - maxEntries} more`);
  return shown;
}

export function inspectValue(value: unknown, options: InspectOptions = {}): unknown {
  const maxDepth = Math.min(Math.max(options.depth ?? 2, 0), MAX_DEPTH);
  const maxEntries = Math.min(Math.max(options.maxEntries ?? 40, 1), MAX_ENTRIES);
  const ancestors: object[] = [];

  const walk = (current: unknown, depth: number): unknown => {
    if (current === null || current === undefined) return current ?? null;
    if (typeof current === "string") return current.length > MAX_STRING ? `${current.slice(0, MAX_STRING)}…` : current;
    if (typeof current === "number") return Number.isFinite(current) ? current : String(current);
    if (typeof current === "boolean") return current;
    if (typeof current === "function") return "function";
    if (typeof current !== "object") return String(current);
    if (ancestors.includes(current)) return "[circular]";
    if (depth > maxDepth || isDomNode(current)) return summarize(current);

    ancestors.push(current);
    try {
      if (Array.isArray(current)) return limited(current, maxEntries, (item) => walk(item, depth + 1));
      if (current instanceof Set) return { $set: limited([...current], maxEntries, (item) => walk(item, depth + 1)) };
      if (current instanceof Map) {
        return { $map: limited([...current], maxEntries, ([key, item]) => [walk(key, maxDepth + 1), walk(item, depth + 1)]) };
      }
      const keys = dataKeys(current);
      const result: Record<string, unknown> = {};
      const label = className(current);
      if (label) result.$class = label;
      for (const key of keys.slice(0, maxEntries)) result[key] = walk((current as Record<string, unknown>)[key], depth + 1);
      if (keys.length > maxEntries) result["…"] = `${keys.length - maxEntries} more keys`;
      return result;
    } finally {
      ancestors.pop();
    }
  };

  return walk(value, 0);
}

function step(container: unknown, segment: string): unknown {
  if (container instanceof Map) {
    for (const [key, value] of container) {
      if (String(key) === segment || (key as { name?: unknown } | null)?.name === segment) return value;
    }
    return undefined;
  }
  if (container instanceof Set) return [...container][Number(segment)];
  if (container === null || (typeof container !== "object" && typeof container !== "function")) return undefined;
  return (container as Record<string, unknown>)[segment];
}

export type InspectResult = { ok: true; path: string; value: unknown } | { ok: false; error: string };

/** Resolves a dotted path such as `game.state.zones.3.cardStacks` from named roots and dumps what it finds. */
export function inspectPath(roots: Record<string, () => unknown>, path: string, options: InspectOptions = {}): InspectResult {
  const [rootName, ...segments] = path.split(".").filter(Boolean);
  const root = rootName !== undefined ? roots[rootName] : undefined;
  if (!root) return { ok: false, error: `unknown root "${rootName ?? ""}"; roots are ${Object.keys(roots).join(", ")}` };
  let current: unknown = root();
  const walked = [rootName];
  for (const segment of segments) {
    if (current === null || current === undefined) return { ok: false, error: `${walked.join(".")} is ${String(current)}` };
    current = step(current, segment);
    walked.push(segment);
  }
  return { ok: true, path: walked.join("."), value: inspectValue(current, options) };
}
