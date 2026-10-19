import { createRoute, z } from "@hono/zod-openapi";
import { apiError, createRouter, errorResponse } from "../../src/platform/errors.ts";
import { requireIdentity, unauthenticatedResponse } from "../../src/platform/identity.ts";

// Test-only routes of the Skeleton's test composition: a read with a path and a
// query parameter that can answer 404, and a write with a JSON body. They give
// the MCP tests a `read` and a `write` tool; no table behind them.

const Note = z
  .object({
    id: z.string().openapi({ description: "The note's id." }),
    text: z.string().openapi({ description: "What the note says." }),
    authorId: z.string().openapi({ description: "The id of the user the request acts for." }),
  })
  .openapi("Note");

const getNote = createRoute({
  method: "get",
  path: "/notes/{id}",
  operationId: "getNote",
  summary: "Get a note",
  description: "Answers the note `welcome`; any other id is not found.",
  middleware: [requireIdentity] as const,
  request: {
    params: z.object({ id: z.string().openapi({ description: "The note's id." }) }),
    query: z.object({ shout: z.enum(["yes", "no"]).optional().openapi({ description: "`yes` upper-cases the text." }) }),
  },
  responses: {
    200: { description: "The note.", content: { "application/json": { schema: Note } } },
    401: unauthenticatedResponse,
    404: errorResponse("No note with this id.", "NOT_FOUND"),
  },
});

const createNote = createRoute({
  method: "post",
  path: "/notes",
  operationId: "createNote",
  summary: "Create a note",
  description: "Answers the note it would create for the signed-in user. Nothing is stored.",
  middleware: [requireIdentity] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ text: z.string().min(1).max(200) }) } },
    },
  },
  responses: {
    201: { description: "The new note.", content: { "application/json": { schema: Note } } },
    400: errorResponse("The text is empty or too long.", "VALIDATION_FAILED"),
    401: unauthenticatedResponse,
  },
});

export const notes = createRouter()
  .openapi(getNote, (c) => {
    if (c.req.valid("param").id !== "welcome") return c.json(apiError("NOT_FOUND"), 404);
    const text = c.req.valid("query").shout === "yes" ? "WELCOME" : "Welcome";
    return c.json({ id: "welcome", text, authorId: c.var.identity.user.id }, 200);
  })
  .openapi(createNote, (c) =>
    c.json({ id: crypto.randomUUID(), text: c.req.valid("json").text, authorId: c.var.identity.user.id }, 201),
  );
