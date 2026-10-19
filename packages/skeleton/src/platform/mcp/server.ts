import { fromJsonSchema, McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import type { Feature } from "../feature.ts";
import type { McpTool } from "./tool.ts";

/** Calls a tool's route inside the Worker and answers with the route's response. */
export type RouteCaller = (request: Request) => Promise<Response>;

/**
 * The MCP server for one request: a tool per generated operation the token's
 * scopes reach (a `read` token never sees a `write` tool, in `tools/list` or
 * `tools/call`), each answering through its own `/api` route.
 */
export function createMcpServer({
  name,
  tools,
  features = [],
  scopes,
  origin,
  callRoute,
}: {
  name: string;
  tools: readonly McpTool[];
  features?: readonly Feature[];
  scopes: readonly string[];
  /** The origin `/mcp` was reached on: the routes see the same one. */
  origin: string;
  callRoute: RouteCaller;
}) {
  const server = new McpServer({ name, version: "1.0.0" });
  for (const tool of tools) {
    if (!scopes.includes(tool.scope)) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema),
        ...(tool.outputSchema && { outputSchema: fromJsonSchema(tool.outputSchema) }),
        annotations: tool.annotations,
      },
      async (args) => resultOf(tool, await callRoute(routeRequest(tool, args, origin))),
    );
  }
  for (const feature of features) feature.mcp?.(server);
  return server;
}

/** The HTTP request a tool call stands for: path and query parameters from the arguments, `body` as JSON. */
function routeRequest(tool: McpTool, args: Record<string, unknown>, origin: string): Request {
  const { method, path, pathParams, queryParams, body } = tool.http;
  let pathname = path;
  for (const name of pathParams) pathname = pathname.replace(`{${name}}`, encodeURIComponent(String(args[name])));
  const url = new URL(pathname, origin);
  for (const name of queryParams) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(item));
  }
  const headers = new Headers({ accept: "application/json" });
  const hasBody = body && args.body !== undefined;
  if (hasBody) headers.set("content-type", "application/json");
  return new Request(url, { method, headers, body: hasBody ? JSON.stringify(args.body) : undefined });
}

/**
 * A 2xx answers with its JSON body as `structuredContent` (and as text, for
 * clients that only read `content`). Any other status is a tool error with the
 * API's English message, which the agent can act on.
 */
async function resultOf(tool: McpTool, response: Response): Promise<CallToolResult> {
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("application/json") && text ? parse(text) : undefined;
  if (!response.ok) {
    const { code, message } = (json ?? {}) as { code?: unknown; message?: unknown };
    const reason = typeof message === "string" ? message : text || response.statusText;
    return {
      isError: true,
      content: [{ type: "text", text: typeof code === "string" ? `${code}: ${reason}` : `HTTP ${response.status}: ${reason}` }],
    };
  }
  if (tool.http.output === "none" || json === undefined) {
    return { content: [{ type: "text", text: text || `Done (HTTP ${response.status}).` }] };
  }
  const structuredContent = (tool.http.output === "result" ? { result: json } : json) as Record<string, unknown>;
  return { structuredContent, content: [{ type: "text", text: JSON.stringify(json) }] };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
