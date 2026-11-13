export type NavigatorConfig = {
  chrome?: { profile?: string; debugPort?: number; binary?: string; url?: string };
  agent?: {
    command?: string;
    cwd?: string;
    model?: string;
    allowHumanOpponents?: boolean;
    allowedTools?: string[];
    extraArgs?: string[];
  };
};

export declare function configPath(): string;
export declare function stateDir(): string;
export declare function expandHome(path: string): string;
export declare function loadConfig(): NavigatorConfig;
