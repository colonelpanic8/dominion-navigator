import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatus, parseLauncherRequest } from "../src/agent/launcher-protocol";
import { agentCommand, applyStreamEvent } from "../scripts/lib/agent-runner";

const token = "dn-0a92f76e236c821512ea90b75d7e8da5";

test("the launcher accepts only well-formed requests that carry an agent token", () => {
  assert.deepEqual(parseLauncherRequest(JSON.stringify({ id: 3, type: "start", kind: "play", token, prompt: "Play." })), {
    ok: true,
    request: { id: 3, type: "start", kind: "play", token, prompt: "Play." }
  });
  assert.deepEqual(parseLauncherRequest(JSON.stringify({ id: 4, type: "stop", token })), { ok: true, request: { id: 4, type: "stop", token } });

  const refused = (request: unknown): string | undefined => {
    const parsed = parseLauncherRequest(JSON.stringify(request));
    return parsed.ok ? undefined : parsed.error;
  };
  assert.match(refused({ id: 1, type: "status", token: "not-a-token" })!, /agent token/);
  assert.match(refused({ id: 1, type: "start", kind: "resign", token, prompt: "x" })!, /kind/);
  assert.match(refused({ id: 1, type: "start", kind: "ask", token, prompt: "   " })!, /prompt/);
  assert.match(refused({ id: 1, type: "exec", token })!, /Unknown request/);
  assert.equal(parseLauncherRequest("{").ok, false);
});

test("an agent gets the dominion server for its run only, and no tools beyond the allowed ones", () => {
  const { command, args, cwd } = agentCommand({ root: "/repo", tsxLoader: "file:///repo/node_modules/tsx/dist/loader.mjs", agent: {} });
  assert.equal(command, "claude");
  assert.equal(cwd, "/repo");
  assert.ok(args.includes("--strict-mcp-config"));
  assert.deepEqual(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2), ["--permission-mode", "dontAsk"]);
  assert.ok(args.includes("--allowedTools=mcp__dominion,Read,Glob,Grep,Skill"));
  const server = JSON.parse(args[args.indexOf("--mcp-config") + 1]!).mcpServers.dominion;
  assert.deepEqual(server.args, [
    "--import",
    "file:///repo/node_modules/tsx/dist/loader.mjs",
    "/repo/scripts/mcp-server.ts",
    "--allow-human-opponents"
  ]);

  const botsOnly = agentCommand({ root: "/repo", tsxLoader: "tsx", agent: { allowHumanOpponents: false, model: "opus", cwd: "/play" } });
  assert.ok(!JSON.parse(botsOnly.args[botsOnly.args.indexOf("--mcp-config") + 1]!).mcpServers.dominion.args.includes("--allow-human-opponents"));
  assert.deepEqual(botsOnly.args.slice(botsOnly.args.indexOf("--model"), botsOnly.args.indexOf("--model") + 2), ["--model", "opus"]);
  assert.equal(botsOnly.cwd, "/play");
});

test("the agent's stream shows its moves, its latest words and its final answer", () => {
  const status: AgentStatus = { id: "a", kind: "play", state: "running", startedAt: 0, moves: 0, logPath: "/log" };
  applyStreamEvent(status, { type: "system", subtype: "init" });
  applyStreamEvent(status, {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Plan: Witch, then Gold." },
        { type: "tool_use", name: "mcp__dominion__step", input: { indices: [2], reason: "Witch first" } }
      ]
    }
  });
  applyStreamEvent(status, { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__dominion__wait", input: {} }] } });
  assert.equal(status.moves, 1);
  assert.equal(status.lastReason, "Witch first");
  assert.equal(status.text, "Plan: Witch, then Gold.");

  applyStreamEvent(status, { type: "result", result: "Won 34 to 21.", is_error: false });
  assert.equal(status.state, "done");
  assert.equal(status.text, "Won 34 to 21.");

  const stopped: AgentStatus = { ...status, state: "stopped" };
  applyStreamEvent(stopped, { type: "result", result: "", is_error: true });
  assert.equal(stopped.state, "stopped");
});
