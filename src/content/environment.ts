type ChromeStorageArea = {
  get?: (keys: string | string[] | Record<string, unknown>, callback: (items: Record<string, unknown>) => void) => void;
  set?: (items: Record<string, unknown>, callback?: () => void) => void;
};

type ChromeApi = {
  runtime?: {
    getURL?: (path: string) => string;
    lastError?: { message?: string };
  };
  storage?: {
    local?: ChromeStorageArea;
  };
};

export const chromeApi: ChromeApi | undefined = (globalThis as typeof globalThis & { chrome?: ChromeApi }).chrome;

export function extensionStorage(): ChromeStorageArea | undefined {
  return chromeApi?.storage?.local;
}

/** The "Game #123" number shown by the client, when one is visible. */
export function currentGameNumber(): string | undefined {
  return document.body?.innerText.match(/Game #(\d+)/)?.[1];
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}
