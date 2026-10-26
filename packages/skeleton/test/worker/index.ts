import { sql } from "drizzle-orm";
import { createApp, defineFeature, defineProduct, type McpTool, type Transaction } from "../../src/index.ts";
import mcpTools from "./mcp-tools.gen.json" with { type: "json" };
import { createDeletingCompanies, createUndeletableCompanies } from "./events.ts";
import { notes } from "./notes.ts";

export { PasswordHasher, RateLimiter } from "../../src/durable-objects.ts";

/** Records a feature's `companyDeleting` where the tests read it. */
async function recordDeleting(feature: string, { db, companyId }: { db: Transaction; companyId: string }) {
  await db.execute(sql.raw(createDeletingCompanies));
  await db.execute(
    sql`INSERT INTO public.deleting_companies (company_id, feature, members)
        SELECT ${companyId}, ${feature}, count(*) FROM skeleton.members WHERE company_id = ${companyId}`,
  );
}

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
        companyDeleting: (event) => recordDeleting("notes", event),
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
    // A second feature, after `notes`: the tests see the events run in the Product's order,
    // and that its throwing rolls back the deletion, `notes`' work included.
    defineFeature({
      id: "archive",
      api() {},
      events: {
        async companyDeleting(event) {
          await recordDeleting("archive", event);
          await event.db.execute(sql.raw(createUndeletableCompanies));
          const { rows } = await event.db.execute(
            sql`SELECT 1 FROM public.undeletable_companies WHERE company_id = ${event.companyId}`,
          );
          if (rows.length > 0) throw new Error(`The archive refuses to delete ${event.companyId}.`);
        },
      },
    }),
  ],
  mcpTools: mcpTools satisfies McpTool[],
}) satisfies ExportedHandler<Env>;
