/** Where a bundle came from, stamped in by `scripts/lib/extension-build.mjs`. */
export type BuildInfo = {
  commit: string;
  dirty: boolean;
  builtAt: string;
};

declare const __NAVIGATOR_BUILD__: BuildInfo | undefined;

/** Undefined outside a bundle, e.g. under the Node test runner. */
export const BUILD: BuildInfo | undefined = typeof __NAVIGATOR_BUILD__ === "undefined" ? undefined : __NAVIGATOR_BUILD__;
