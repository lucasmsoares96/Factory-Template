import { createApp, type McpTool } from "@workspace/skeleton";
import product from "../product.config.ts";
import { features } from "./features/index.ts";
import mcpTools from "./mcp-tools.gen.json" with { type: "json" };

export { PasswordHasher, RateLimiter } from "@workspace/skeleton/durable-objects";

export default createApp({
  product,
  features,
  // Written by `pnpm generate` from the composed OpenAPI document: one MCP tool per operation.
  mcpTools: mcpTools satisfies McpTool[],
}) satisfies ExportedHandler<Env>;
