import { createRoute, z } from "@hono/zod-openapi";
import { apiError, createRouter, errorResponse } from "../../src/platform/errors.ts";
import { requireIdentity, unauthenticatedResponse } from "../../src/platform/identity.ts";
import { CompanyParams, companyNotFoundResponse, createInvitation, requireMember, skeletonRole } from "../../src/index.ts";

// Test-only routes of the Skeleton's test composition: a read with a path and a
// query parameter that can answer 404, and a write with a JSON body. They give
// the MCP tests a `read` and a `write` tool; no table behind them. A Company
// route shows how a Product guards its own routes with the Skeleton's `requireMember`,
// and another how it builds Invitations of its own with the Skeleton's `createInvitation`.

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

const CompanyNote = z
  .object({
    companyId: z.string().openapi({ description: "The Company of the path." }),
    userId: z.string().openapi({ description: "The id of the user the request acts for." }),
    role: z.string().openapi({ description: "Their role in the Company, as stored." }),
    skeletonRole: z.enum(["owner", "employee"]).openapi({ description: "What the role counts as on the Skeleton's routes." }),
  })
  .openapi("CompanyNote");

const getCompanyNote = createRoute({
  method: "get",
  path: "/companies/{companyId}/notes/welcome",
  operationId: "getCompanyNote",
  summary: "Get a Company's welcome note",
  description: "Answers who the signed-in user is in the Company, as the Skeleton's `requireMember` resolved it.",
  middleware: [requireIdentity, requireMember] as const,
  request: { params: CompanyParams },
  responses: {
    200: { description: "The caller's membership.", content: { "application/json": { schema: CompanyNote } } },
    401: unauthenticatedResponse,
    404: companyNotFoundResponse,
  },
});

const inviteFromNotes = createRoute({
  method: "post",
  path: "/companies/{companyId}/notes/invitations",
  operationId: "inviteFromNotes",
  summary: "Invite someone as an Employee, as any Member",
  description:
    "A Product's own Invitation rule: any Member invites, always with the role `employee`, through the Skeleton's `createInvitation`.",
  middleware: [requireIdentity, requireMember] as const,
  request: {
    params: CompanyParams,
    body: { required: true, content: { "application/json": { schema: z.object({ email: z.email() }) } } },
  },
  responses: {
    201: { description: "The pending Invitation.", content: { "application/json": { schema: z.object({ id: z.string(), email: z.string(), role: z.string() }) } } },
    400: errorResponse("The email is not valid.", "VALIDATION_FAILED"),
    401: unauthenticatedResponse,
    404: companyNotFoundResponse,
    409: errorResponse("Already a Member, or already invited.", "ALREADY_A_MEMBER", "INVITATION_PENDING"),
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
  )
  .openapi(getCompanyNote, (c) => c.json({ ...c.var.member, skeletonRole: skeletonRole(c.var.member.role) }, 200))
  .openapi(inviteFromNotes, async (c) => {
    const result = await createInvitation(c, { email: c.req.valid("json").email, role: "employee" });
    if ("invitation" in result) return c.json(result.invitation, 201);
    if (result.refused === "VALIDATION_FAILED") return c.json(apiError(result.refused), 400);
    return c.json(apiError(result.refused), 409);
  });
