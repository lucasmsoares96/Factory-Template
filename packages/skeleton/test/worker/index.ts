import { sql } from "drizzle-orm";
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
      // An entry the signed-in navigation shows next to the Skeleton's own.
      nav: { label: "Notes", to: "/notes" },
      // A section of the Company page next to the Skeleton's own.
      companyPage: { label: "Notes", to: "/notes" },
      events: {
        // Records each event where the tests read it: a table of the test database only.
        async memberJoined({ db, companyId, userId }) {
          await db.execute(sql`CREATE TABLE IF NOT EXISTS public.joined_members (company_id text, user_id text)`);
          await db.execute(sql`INSERT INTO public.joined_members VALUES (${companyId}, ${userId})`);
        },
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
