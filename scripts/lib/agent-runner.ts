// Starts agents for the overlay (through the launcher) and tracks them. Each agent is a
// `claude` or `codex` run given the dominion MCP server for this run only, so no agent
// configuration has to register it.
import { ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { AgentKind, AgentStatus } from "../../src/agent/launcher-protocol";
import { AgentProgram, expandHome, loadConfig, NavigatorConfig, stateDir } from "./config.mjs";

type AgentConfig = NonNullable<NavigatorConfig["agent"]>;

const DEFAULT_ALLOWED_TOOLS = ["mcp__dominion", "Read", "Glob", "Grep", "Skill"];
const CODEX_DISABLED_FEATURES = ["apps", "plugins", "hooks", "multi_agent", "multi_agent_v2", "browser_use", "computer_use", "image_generation", "remote_plugin"];
const MAX_TEXT_CHARS = 4000;

export function resolveAgentProgram(agent: AgentConfig): AgentProgram {
  if (agent.program) return agent.program;
  const cmd = agent.command ? basename(agent.command) : "";
  if (cmd === "codex" || cmd.startsWith("codex-")) return "codex";
  if (agent.model && /^(gpt-|o[134]-|codex)/.test(agent.model)) return "codex";
  return "claude";
}

/** The command that runs one agent. The prompt goes to its stdin. */
export function agentCommand(options: { root: string; tsxLoader: string; agent: AgentConfig; gameLogDir?: string }): {
  program: AgentProgram;
  command: string;
  args: string[];
  cwd: string;
} {
  const { root, tsxLoader, agent, gameLogDir } = options;
  const program = resolveAgentProgram(agent);
  const cwd = expandHome(agent.cwd ?? root);
  const resolvedLogDir = expandHome(agent.gameLogDir ?? gameLogDir ?? "");
  const meta = JSON.stringify({ program, ...(agent.model ? { model: agent.model } : {}), ...(agent.effort ? { effort: agent.effort } : {}) });
  const serverArgs = [
    "--import",
    tsxLoader,
    resolve(root, "scripts/mcp-server.ts"),
    ...(resolvedLogDir ? ["--game-log-dir", resolvedLogDir, "--game-log-meta", meta] : [])
  ];
  const server = {
    command: process.execPath,
    args: serverArgs
  };

  if (program === "codex") {
    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--sandbox",
      "danger-full-access",
      "--json",
      "-C",
      cwd,
      "-c",
      'approval_policy="never"',
      "-c",
      "agents.enabled=false",
      "-c",
      'web_search="disabled"',
      "-c",
      `mcp_servers.dominion.command=${JSON.stringify(server.command)}`,
      "-c",
      `mcp_servers.dominion.args=${JSON.stringify(server.args)}`,
      "-c",
      "mcp_servers.dominion.required=true",
      "-c",
      "mcp_servers.dominion.tool_timeout_sec=420",
      "-c",
      'mcp_servers.dominion.default_tools_approval_mode="approve"',
      ...(agent.effort ? ["-c", `model_reasoning_effort=${JSON.stringify(agent.effort)}`] : []),
      ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
      ...(agent.model ? ["--model", agent.model] : []),
      ...(agent.extraArgs ?? []),
      "-"
    ];
    return { program, command: agent.command ?? "codex", args, cwd };
  }

  const args = [
    "-p",
    "--mcp-config",
    JSON.stringify({ mcpServers: { dominion: server } }),
    "--strict-mcp-config",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    `--allowedTools=${(agent.allowedTools ?? DEFAULT_ALLOWED_TOOLS).join(",")}`,
    ...(agent.model ? ["--model", agent.model] : []),
    ...(agent.effort ? ["--effort", agent.effort] : []),
    ...(agent.extraArgs ?? [])
  ];
  return { program, command: agent.command ?? "claude", args, cwd };
}

const clip = (text: string): string => (text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text);

/** Folds one line of Claude (`stream-json`) or Codex (`--json`) output into the agent's status. */
export function applyStreamEvent(status: AgentStatus, event: unknown): void {
  if (typeof event !== "object" || event === null) return;
  const { type, message, result, is_error: isError, item, error } = event as Record<string, unknown>;
  if (type === "assistant" && typeof message === "object" && message !== null) {
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return;
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) status.text = clip(block.text.trim());
      if (block.type === "tool_use" && block.name === "mcp__dominion__step") {
        status.moves += 1;
        const reason = (block.input as { reason?: unknown } | undefined)?.reason;
        if (typeof reason === "string") status.lastReason = clip(reason);
      }
    }
  }
  if (type === "result") {
    if (typeof result === "string" && result.trim()) status.text = clip(result.trim());
    if (status.state === "running") status.state = isError ? "failed" : "done";
  }
  if (type === "item.completed" && typeof item === "object" && item !== null) {
    const record = item as Record<string, unknown>;
    if ((record.type === "agent_message" || record.type === "reasoning") && typeof record.text === "string" && record.text.trim()) {
      status.text = clip(record.text.trim());
    }
    if (record.type === "mcp_tool_call" && record.server === "dominion" && record.tool === "step" && !record.error) {
      status.moves += 1;
      const reason = (record.arguments as { reason?: unknown } | undefined)?.reason;
      if (typeof reason === "string" && reason.trim()) status.lastReason = clip(reason.trim());
    }
  }
  if (type === "turn.completed" && status.state === "running") {
    status.state = "done";
  }
  if (type === "turn.failed" && status.state === "running") {
    status.state = "failed";
    const errMsg = typeof error === "object" && error !== null ? (error as { message?: unknown }).message : error;
    if (typeof errMsg === "string" && errMsg.trim()) status.error = clip(errMsg.trim());
  }
}

type Agent = { status: AgentStatus; token: string; child: ChildProcess };

export class AgentRunner {
  private readonly agents = new Map<string, Agent>();
  private serial = 0;

  constructor(private readonly root: string) {}

  /** Agents started with `token`, oldest first. */
  list(token: string): AgentStatus[] {
    return [...this.agents.values()].filter((agent) => agent.token === token).map((agent) => ({ ...agent.status }));
  }

  start(kind: AgentKind, token: string, prompt: string, overrides: AgentConfig = {}): { ok: true } | { ok: false; error: string } {
    if (kind === "play" && [...this.agents.values()].some((agent) => agent.token === token && agent.status.kind === "play" && agent.status.state === "running")) {
      return { ok: false, error: "An agent is already playing this game." };
    }
    const agentConfig = { ...loadConfig().agent, ...overrides };
    const logDir = join(stateDir(), "agents");
    const gamesDir = join(stateDir(), "games");
    mkdirSync(logDir, { recursive: true });
    mkdirSync(gamesDir, { recursive: true });
    const { command, args, cwd } = agentCommand({ root: this.root, tsxLoader: import.meta.resolve("tsx"), agent: agentConfig, gameLogDir: gamesDir });
    const startedAt = Date.now();
    const id = `${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}-${kind}-${++this.serial}`;
    const logPath = join(logDir, `${id}.jsonl`);
    const status: AgentStatus = { id, kind, state: "running", startedAt, moves: 0, logPath };

    let child: ChildProcess;
    try {
      child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      return { ok: false, error: `Could not start ${command}: ${String(error)}` };
    }
    const log = createWriteStream(logPath);
    let stderr = "";
    let buffered = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      log.write(chunk);
      buffered += chunk.toString("utf8");
      let newline;
      while ((newline = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        try {
          applyStreamEvent(status, JSON.parse(line));
        } catch {
          // Not every line has to be an event.
        }
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", (error) => {
      status.state = "failed";
      status.error = `Could not start ${command}: ${error.message}`;
    });
    child.on("exit", (code, signal) => {
      log.end();
      if (status.state !== "running") return;
      status.state = signal ? "stopped" : "failed";
      if (!signal) status.error = stderr.trim().split("\n").at(-1) || `${command} exited with code ${code}.`;
    });
    child.stdin!.end(prompt);
    this.agents.set(id, { status, token, child });
    return { ok: true };
  }

  /** Stops `token`'s running agents, or just `agentId`. */
  stop(token: string, agentId?: string): void {
    for (const agent of this.agents.values()) {
      if (agent.token !== token || (agentId && agent.status.id !== agentId) || agent.status.state !== "running") continue;
      agent.status.state = "stopped";
      agent.child.kill("SIGTERM");
    }
  }

  stopAll(): void {
    for (const agent of this.agents.values()) if (agent.status.state === "running") agent.child.kill("SIGTERM");
  }
}
