export declare const DEFAULT_DEBUG_PORT: number;
export declare const LAUNCHER_PID_FILE: string;
export declare function chromeProfile(): string;
export declare function debugPort(...legacyEnvNames: string[]): number;
export declare function debugUrl(port: number, path: string): string;
export declare function sleep(ms: number): Promise<void>;
export declare function fetchJson(url: string, init?: RequestInit): Promise<unknown>;

export type CdpResponse = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

export type CdpClient = {
  send(method: string, params?: object, sessionId?: string): Promise<CdpResponse>;
  close(): void;
};

export declare function connectCdp(webSocketDebuggerUrl: string, options?: { timeoutMs?: number }): Promise<CdpClient>;
export declare function evaluate(client: CdpClient, expression: string, options?: object): Promise<unknown>;
