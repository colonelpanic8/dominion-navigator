import type { AgentView } from "./agent/types";
import { listenForNavigatorMessages, postNavigatorMessage } from "./message-bus";
import { CardMoveSummary, MESSAGE_SOURCE, NavigatorSnapshot } from "./messages";
import { AgentBridge, WaitResult } from "./probe/agent-bridge";
import { showDrawKnowledgeWindow } from "./probe/knowledge-modal";
import { DominionGlobals, getGame, RuntimeCardMove, RuntimeGame } from "./probe/runtime-types";
import type { AnswerResult } from "./probe/questions";
import { GAME_NOT_READY, postStatus } from "./probe/status";
import { gameFingerprint, makeMoveSummary, makeSnapshot } from "./probe/summaries";

/** Debug handle exposed as `window.__dominionNavigator`. */
type ProbeState = {
  installed: true;
  game?: RuntimeGame;
  gameInstanceId: string;
  gameInstanceSerial: number;
  gameFingerprint: string | undefined;
  lastTurnNumber: number | undefined;
  events: Array<CardMoveSummary | NavigatorSnapshot>;
  requestSnapshot: () => void;
  getAgentView: () => AgentView;
  getAgentViewText: () => string;
  waitForDecision: (options?: { timeoutMs?: number; pollMs?: number }) => Promise<WaitResult>;
  answer: (decisionId: string, indices: number[]) => AnswerResult;
  debugState: AgentBridge["debugState"];
};

const win = window as Window & typeof globalThis & DominionGlobals & { __dominionNavigator?: ProbeState };

const PATCHED_MARKER = "__dominionNavigatorPatched";
const agent = new AgentBridge();

function emitMoveSummary(game: RuntimeGame, move: RuntimeCardMove, phase: CardMoveSummary["phase"]): void {
  try {
    const summary = makeMoveSummary(game, move, phase);
    win.__dominionNavigator?.events.push(summary);
    postNavigatorMessage({ source: MESSAGE_SOURCE, type: "card-move", seq: agent.nextEventSeq(), payload: summary });
  } catch (error) {
    postStatus(false, `Failed to summarize ${phase} card move: ${String(error)}`);
  }
}

function emitSnapshot(): void {
  const game = getGame();
  if (!game?.state) {
    postStatus(false, GAME_NOT_READY);
    return;
  }

  const snapshot = makeSnapshot(game, win.__dominionNavigator?.gameInstanceId ?? "unknown-game");
  win.__dominionNavigator?.events.push(snapshot);
  postNavigatorMessage({ source: MESSAGE_SOURCE, type: "snapshot", seq: agent.nextEventSeq(), payload: snapshot });
}

function startNewGameInstance(game: RuntimeGame, fingerprint?: string): void {
  const probe = win.__dominionNavigator;
  if (!probe) return;
  probe.game = game;
  probe.gameFingerprint = fingerprint ?? gameFingerprint(game);
  probe.lastTurnNumber = game.state?.activeTurn?.turnNumber;
  probe.gameInstanceSerial += 1;
  probe.gameInstanceId = `game-${probe.gameInstanceSerial}-${Date.now()}`;
  probe.events = [];
  agent.resetForNewGame();
}

function updateGameInstance(game: RuntimeGame): void {
  const probe = win.__dominionNavigator;
  if (!probe) return;

  const fingerprint = gameFingerprint(game);
  const turnNumber = game.state?.activeTurn?.turnNumber;
  const isDifferentGame = Boolean(probe.gameFingerprint && fingerprint && probe.gameFingerprint !== fingerprint);
  const turnMovedBackwards = probe.lastTurnNumber !== undefined && turnNumber !== undefined && turnNumber < probe.lastTurnNumber;

  if (isDifferentGame || turnMovedBackwards) {
    startNewGameInstance(game, fingerprint);
  } else {
    probe.game = game;
    probe.gameFingerprint = fingerprint ?? probe.gameFingerprint;
    probe.lastTurnNumber = turnNumber ?? probe.lastTurnNumber;
  }
}

function installGameLifecycleHook(game: RuntimeGame): void {
  const readState = game.readState;
  if (!readState || Reflect.get(readState, PATCHED_MARKER)) return;

  const patched = function patchedReadState(this: RuntimeGame, isReconnect: boolean, reader: unknown): unknown {
    const result = readState.call(this, isReconnect, reader);
    window.setTimeout(() => {
      updateGameInstance(this);
      installCardMoveHook();
      emitSnapshot();
    }, 0);
    window.setTimeout(emitSnapshot, 500);
    return result;
  };

  Reflect.set(patched, PATCHED_MARKER, true);
  game.readState = patched;
}

function installCardMoveHook(): void {
  const prototype = win.CardMove?.prototype;
  const execute = prototype?.execute;
  if (!prototype || !execute || Reflect.get(execute, PATCHED_MARKER)) return;

  const patched = function patchedCardMoveExecute(this: RuntimeCardMove, gameArg: RuntimeGame, done?: () => void): unknown {
    emitMoveSummary(gameArg, this, "before");

    return execute.call(this, gameArg, () => {
      try {
        emitMoveSummary(gameArg, this, "after");
        emitSnapshot();
      } catch (error) {
        postStatus(false, `Failed to finish card move hook: ${String(error)}`);
      } finally {
        done?.();
      }
    });
  };

  Reflect.set(patched, PATCHED_MARKER, true);
  prototype.execute = patched;
}

function installHooks(game: RuntimeGame): void {
  installGameLifecycleHook(game);
  installCardMoveHook();
}

function install(): void {
  if (win.__dominionNavigator?.installed) {
    emitSnapshot();
    return;
  }

  const game = getGame();
  const probe: ProbeState = {
    installed: true,
    gameInstanceId: `game-0-${Date.now()}`,
    gameInstanceSerial: 0,
    gameFingerprint: undefined,
    lastTurnNumber: undefined,
    events: [],
    requestSnapshot: emitSnapshot,
    getAgentView: () => agent.getAgentView(),
    getAgentViewText: () => agent.getAgentViewText(),
    waitForDecision: (options) => agent.waitForDecision(options),
    answer: (decisionId, indices) => agent.answer(decisionId, indices),
    debugState: () => agent.debugState()
  };
  win.__dominionNavigator = probe;
  if (game) probe.game = game;

  if (!game?.state) {
    postStatus(false, GAME_NOT_READY);
  } else {
    probe.gameFingerprint = gameFingerprint(game);
    probe.lastTurnNumber = game.state.activeTurn?.turnNumber;
    installHooks(game);
    postStatus(true);
    emitSnapshot();
  }

  listenForNavigatorMessages((message) => {
    switch (message.type) {
      case "request-snapshot": {
        const currentGame = getGame();
        if (currentGame) {
          probe.game = currentGame;
          installHooks(currentGame);
        }
        emitSnapshot();
        return;
      }
      case "show-draw-knowledge-window":
        showDrawKnowledgeWindow(message.payload);
        return;
      case "knowledge-update":
        agent.updateKnowledge(message.payload.seq, message.payload.summary);
        return;
    }
  });
}

install();
