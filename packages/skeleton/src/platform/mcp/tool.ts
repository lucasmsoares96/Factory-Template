/** A JSON Schema (2020-12) object. */
export type JsonSchema = { [keyword: string]: unknown };

/** The OAuth scopes a Connection can hold: `read` for GET operations, `write` for the rest. */
export const MCP_SCOPES = ["read", "write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/**
 * One MCP tool: an `/api` operation of the composed OpenAPI document, as
 * `pnpm generate` writes it to the Product's `mcp-tools.gen.json` (committed:
 * it is also the snapshot of `tools/list`). Fields are typed loosely enough for
 * the JSON import to fit; the generator is what guarantees their values.
 */
export type McpTool = {
  /** The operation's `operationId`. */
  name: string;
  /** The operation's `summary`. */
  title: string;
  /** The operation's `description`. */
  description: string;
  /** Path and query parameters by name, plus the JSON request body as `body`. */
  inputSchema: JsonSchema;
  /** The 2xx JSON response (wrapped as `{ result }` when it is not an object). */
  outputSchema?: JsonSchema;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint: boolean;
  };
  /** The scope a token needs to see and call the tool (`McpScope`). */
  scope: string;
  /** How the tool calls its route inside the Worker. */
  http: {
    method: string;
    /** The OpenAPI path, `{name}` for each path parameter. */
    path: string;
    pathParams: string[];
    queryParams: string[];
    /** Whether the tool's `body` argument goes out as the JSON request body. */
    body: boolean;
    /** `object`: the response is the structured content; `result`: it goes under `result`; `none`: no JSON. */
    output: string;
  };
};
