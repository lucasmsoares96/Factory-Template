import { createApp, type McpTool } from "@workspace/skeleton";
import { messages } from "./client/messages.ts";
import mcpTools from "./mcp-tools.gen.json" with { type: "json" };

export { PasswordHasher, RateLimiter } from "@workspace/skeleton/durable-objects";

export default createApp({
  title: "example",
  emailFrom: "Example <no-reply@example.com>",
  messages,
  // Written by `pnpm generate` from the composed OpenAPI document: one MCP tool per operation.
  mcpTools: mcpTools satisfies McpTool[],
}) satisfies ExportedHandler<Env>;
