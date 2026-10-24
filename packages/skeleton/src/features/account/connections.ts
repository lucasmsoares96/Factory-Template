import { createRoute, z } from "@hono/zod-openapi";
import { apiError, createRouter, errorResponse } from "../../platform/errors.ts";
import { requireIdentity, unauthenticatedResponse } from "../../platform/identity.ts";
import { findConnection, listConnections, revokeConnection } from "../../platform/mcp/connections.ts";

const Connection = z
  .object({
    id: z.string().openapi({ description: "The Connection's id: what revokeConnection takes.", example: "Xk2pQ9vT4mWs1aLb" }),
    appName: z
      .string()
      .openapi({ description: "The name the agent's app gave itself when it connected.", example: "Claude" }),
    createdAt: z.iso
      .datetime()
      .openapi({ description: "When the user authorized the agent.", example: "2026-10-24T14:30:00.000Z" }),
    access: z
      .enum(["read", "write"])
      .openapi({ description: "`read`: the agent only reads; `write`: it also changes data.", example: "read" }),
  })
  .openapi("Connection");

const ConnectionList = z
  .object({
    connections: z.array(Connection).openapi({ description: "One page of the user's Connections." }),
    nextCursor: z
      .string()
      .nullable()
      .openapi({ description: "Pass it as `cursor` for the next page; `null` on the last page.", example: null }),
  })
  .openapi("ConnectionList");

const listConnectionsRoute = createRoute({
  method: "get",
  path: "/connections",
  operationId: "listConnections",
  summary: "List the signed-in user's Connections",
  description:
    "Answers the AI agents the user the request acts for authorized over MCP: the app's name, when it was authorized and its access (`read` or `write`). Pages of `limit` (default 50); pass `nextCursor` back as `cursor` for the next one.",
  middleware: [requireIdentity] as const,
  request: {
    query: z.object({
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .openapi({ description: "How many Connections per page, 1 to 100.", example: 50 }),
      cursor: z
        .string()
        .optional()
        .openapi({ description: "The `nextCursor` of the previous page.", example: "AAAAANuhNPA" }),
    }),
  },
  responses: {
    200: { description: "One page of Connections.", content: { "application/json": { schema: ConnectionList } } },
    400: errorResponse("The limit is not a whole number from 1 to 100.", "VALIDATION_FAILED"),
    401: unauthenticatedResponse,
  },
});

const revokeConnectionRoute = createRoute({
  method: "delete",
  path: "/connections/{id}",
  operationId: "revokeConnection",
  summary: "Revoke one of the signed-in user's Connections",
  description:
    "Deletes the Connection with this id and its tokens: the agent loses access at once and must be authorized again. Only the user's own Connections can be revoked.",
  middleware: [requireIdentity] as const,
  request: {
    params: z.object({
      id: z.string().openapi({ description: "The Connection's id, from listConnections.", example: "Xk2pQ9vT4mWs1aLb" }),
    }),
  },
  responses: {
    204: { description: "The Connection is revoked." },
    401: unauthenticatedResponse,
    404: errorResponse("The user has no Connection with this id.", "NOT_FOUND"),
  },
});

/** The signed-in user's MCP Connections: list and revoke, each user only their own. */
export const connectionsApi = createRouter()
  .openapi(listConnectionsRoute, async (c) => {
    const { limit, cursor } = c.req.valid("query");
    const page = await listConnections(c, c.var.identity.user, { limit, cursor });
    return c.json(page, 200);
  })
  .openapi(revokeConnectionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const user = c.var.identity.user;
    if (!(await findConnection(c, user, id))) return c.json(apiError("NOT_FOUND"), 404);
    await revokeConnection(c, user, id);
    return c.body(null, 204);
  });
