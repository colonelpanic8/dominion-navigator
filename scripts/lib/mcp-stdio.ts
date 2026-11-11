// A Model Context Protocol server over stdio that only serves tools: one JSON-RPC
// message per line on stdin and stdout. Anything else written to stdout would
// corrupt the stream, so diagnostics go to stderr.
import { createInterface } from "node:readline";

export type Tool = {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  inputSchema: object;
  /** Returns the text result; a thrown error becomes an error result the model can read. */
  run(args: Record<string, unknown>): Promise<string>;
};

export type ServerInfo = {
  name: string;
  version: string;
  /** Shown to the model once, when the server connects. */
  instructions: string;
  tools: Tool[];
};

type Request = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Record<string, unknown> };

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PARSE_ERROR = -32700;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

async function handle(server: ServerInfo, method: string, params: Record<string, unknown>): Promise<object> {
  switch (method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: server.name, version: server.version },
        instructions: server.instructions
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: server.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case "tools/call": {
      const tool = server.tools.find((item) => item.name === params.name);
      if (!tool) throw new RpcError(INVALID_PARAMS, `unknown tool ${String(params.name)}`);
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      try {
        return { content: [{ type: "text", text: await tool.run(args) }] };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    }
    default:
      throw new RpcError(METHOD_NOT_FOUND, `method not found: ${method}`);
  }
}

export function serveTools(server: ServerInfo): void {
  const write = (message: object): void => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };

  createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      write({ id: null, error: { code: PARSE_ERROR, message: "parse error" } });
      return;
    }
    const { id, method } = request;
    // Responses and notifications need no reply.
    if (method === undefined || id === undefined) return;
    handle(server, method, request.params ?? {}).then(
      (result) => write({ id, result }),
      (error: unknown) =>
        write({
          id,
          error: { code: error instanceof RpcError ? error.code : INTERNAL_ERROR, message: error instanceof Error ? error.message : String(error) }
        })
    );
  });
}
