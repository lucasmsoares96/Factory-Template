import { createApp, defineFeature, defineProduct, type McpTool } from "../../src/index.ts";
import mcpTools from "./mcp-tools.gen.json" with { type: "json" };
import { notes } from "./notes.ts";

export { PasswordHasher, RateLimiter } from "../../src/durable-objects.ts";

export default createApp({
  product: defineProduct({
    id: "skeleton-test",
    title: "Skeleton Test",
    emailFrom: "Skeleton Test <no-reply@skeleton.test>",
    domain: "skeleton.test",
  }),
  features: [
    defineFeature({
      id: "notes",
      api(app) {
        app.route("/", notes);
      },
      // A tool the OpenAPI document cannot describe: the `mcp?(server)` hook.
      mcp(server) {
        server.registerTool(
          "manualPing",
          { description: "Answers pong. Registered by a feature's mcp hook, not generated." },
          () => ({ content: [{ type: "text", text: "pong" }] }),
        );
      },
    }),
  ],
  mcpTools: mcpTools satisfies McpTool[],
}) satisfies ExportedHandler<Env>;
