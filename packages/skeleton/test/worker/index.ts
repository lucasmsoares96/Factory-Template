import { createApp, type McpTool } from "../../src/index.ts";
import mcpTools from "./mcp-tools.gen.json" with { type: "json" };
import { notes } from "./notes.ts";

export { PasswordHasher, RateLimiter } from "../../src/durable-objects.ts";

export default createApp({
  title: "skeleton-test",
  emailFrom: "Skeleton Test <no-reply@skeleton.test>",
  routers: [notes],
  mcpTools: mcpTools satisfies McpTool[],
}) satisfies ExportedHandler<Env>;
