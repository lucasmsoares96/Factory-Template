import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { users } from "../../db/schema.ts";
import { createRouter, errorResponse } from "../../platform/errors.ts";
import { requireIdentity, unauthenticatedResponse } from "../../platform/identity.ts";
import { Me } from "../me/api.ts";

const UpdateMe = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .openapi({ description: "The new name: 1 to 100 characters once the spaces around it are removed.", example: "Ana Lima" }),
  })
  .openapi("UpdateMe");

const updateMe = createRoute({
  method: "patch",
  path: "/me",
  operationId: "updateMe",
  summary: "Rename the signed-in user",
  description:
    "Changes the name of the user the request acts for (the spaces around it are removed) and answers the user as getMe does.",
  middleware: [requireIdentity] as const,
  request: { body: { required: true, content: { "application/json": { schema: UpdateMe } } } },
  responses: {
    200: { description: "The user, with the new name.", content: { "application/json": { schema: Me } } },
    400: errorResponse("The name is missing, blank or longer than 100 characters.", "VALIDATION_FAILED"),
    401: unauthenticatedResponse,
  },
});

export const accountApi = createRouter().openapi(updateMe, async (c) => {
  const { name } = c.req.valid("json");
  const [user] = await c.var.db
    .update(users)
    .set({ name })
    .where(eq(users.id, c.var.identity.user.id))
    .returning({ id: users.id, name: users.name, email: users.email });
  return c.json(user!, 200);
});
