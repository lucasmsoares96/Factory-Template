import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { users } from "../../db/schema.ts";
import { apiError, createRouter } from "../../platform/errors.ts";
import { requireIdentity, unauthenticatedResponse } from "../../platform/identity.ts";

// The model for every route: a Zod schema named for the OpenAPI document, an
// `operationId` (it names the Kubb hook `useGetMe` and the MCP tool `getMe`), a
// `summary` and a `description` (the tool's description), every response the
// route can answer with its stable error codes, and `requireIdentity` when it
// acts for a user. The handler reads the user from `c.var.identity`, never from
// a cookie or a token.

export const Me = z
  .object({
    id: z.string().openapi({ description: "The user's id." }),
    name: z
      .string()
      .openapi({ description: "The user's name: the one they signed up with, or the last one they chose.", example: "Ana Souza" }),
    email: z.email().openapi({ description: "The user's verified email.", example: "ana@example.com" }),
    pendingEmail: z.email().nullable().openapi({
      description:
        "The address the user asked to change their email to, until they open the link sent there; null when no change is pending.",
      example: null,
    }),
  })
  .openapi("Me");

const getMe = createRoute({
  method: "get",
  path: "/me",
  operationId: "getMe",
  summary: "Get the signed-in user",
  description:
    "Answers the id, name and email of the user the request acts for, and the email they asked to change to, if any.",
  middleware: [requireIdentity] as const,
  responses: {
    200: { description: "The signed-in user.", content: { "application/json": { schema: Me } } },
    401: unauthenticatedResponse,
  },
});

/** The columns of `users` a `Me` answer is made of. */
export const meColumns = { id: users.id, name: users.name, email: users.email, pendingEmail: users.pendingEmail };

export const me = createRouter().openapi(getMe, async (c) => {
  const [user] = await c.var.db.select(meColumns).from(users).where(eq(users.id, c.var.identity.user.id));
  // The user was deleted after `requireIdentity` found them: nobody is signed in any more.
  if (!user) return c.json(apiError("UNAUTHENTICATED"), 401);
  return c.json(user, 200);
});
