import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "../../platform/errors.ts";
import { requireIdentity, unauthenticatedResponse } from "../../platform/identity.ts";

// The model for every route: a Zod schema named for the OpenAPI document, an
// `operationId` (it names the Kubb hook `useGetMe` and the MCP tool `getMe`), a
// `summary` and a `description` (the tool's description), every response the
// route can answer with its stable error codes, and `requireIdentity` when it
// acts for a user. The handler reads the user from `c.var.identity`, never from
// a cookie or a token.

const Me = z
  .object({
    id: z.string().openapi({ description: "The user's id." }),
    name: z.string().openapi({ description: "The name the user signed up with.", example: "Ana Souza" }),
    email: z.email().openapi({ description: "The user's verified email.", example: "ana@example.com" }),
  })
  .openapi("Me");

const getMe = createRoute({
  method: "get",
  path: "/me",
  operationId: "getMe",
  summary: "Get the signed-in user",
  description: "Answers the id, name and email of the user the request acts for.",
  middleware: [requireIdentity] as const,
  responses: {
    200: { description: "The signed-in user.", content: { "application/json": { schema: Me } } },
    401: unauthenticatedResponse,
  },
});

export const me = createRouter().openapi(getMe, (c) => c.json(c.var.identity.user, 200));
