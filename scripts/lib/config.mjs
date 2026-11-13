// Settings for the launcher and the scripts, read from one JSON file. Environment variables
// override it where a script documents one.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const xdgDir = (variable, fallback) => process.env[variable] || join(homedir(), fallback);

export function configPath() {
  return process.env.DOMINION_NAVIGATOR_CONFIG ?? join(xdgDir("XDG_CONFIG_HOME", ".config"), "dominion-navigator", "config.json");
}

/** Where the Chrome profile and agent logs live unless the config puts them elsewhere. */
export function stateDir() {
  return process.env.DOMINION_NAVIGATOR_STATE_DIR ?? join(xdgDir("XDG_STATE_HOME", ".local/state"), "dominion-navigator");
}

export function expandHome(path) {
  return typeof path === "string" && (path === "~" || path.startsWith("~/")) ? join(homedir(), path.slice(1)) : path;
}

let cached;

export function loadConfig() {
  if (cached) return cached;
  const path = configPath();
  try {
    cached = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`Could not read ${path}: ${error.message}`);
    cached = {};
  }
  return cached;
}
