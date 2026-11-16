export type AgentProgram = "claude" | "codex";

export type NavigatorConfig = {
  chrome?: { profile?: string; debugPort?: number; binary?: string; url?: string };
  agent?: {
    program?: AgentProgram;
    command?: string;
    cwd?: string;
    model?: string;
    effort?: string;
    allowedTools?: string[];
    extraArgs?: string[];
    gameLogDir?: string;
  };
};

export declare function configPath(): string;
export declare function stateDir(): string;
export declare function expandHome(path: string): string;
export declare function loadConfig(): NavigatorConfig;
