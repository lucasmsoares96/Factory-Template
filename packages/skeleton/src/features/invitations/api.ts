import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, eq } from "drizzle-orm";
import { invitations, users } from "../../db/schema.ts";
import { apiError, createRouter, errorResponse } from "../../platform/errors.ts";
import { requireIdentity, resolveIdentity, unauthenticatedResponse } from "../../platform/identity.ts";
import { CompanyParams, companyNotFoundResponse, forbiddenResponse, requireMember, requireOwner } from "../../platform/member.ts";
import { PageQuery, afterPosition, cursorPosition, pageOf, toPage } from "../../platform/pagination.ts";
import { Company, toCompany } from "../companies/api.ts";
import { acceptInvitation, createInvitation, invitationByToken, pending, resendInvitation, toInvitation } from "./service.ts";

const Invitation = z
  .object({
    id: z.string().openapi({ description: "The Invitation's id.", example: "6d0b9f3a-2c4e-4f1a-8b7d-1e2f3a4b5c6d" }),
    email: z.email().openapi({ description: "The invited address, lowercase.", example: "bruno@example.com" }),
    role: z.string().openapi({ description: "The role the person will have: `employee` or a role the Product adds.", example: "employee" }),
    invitedBy: z
      .object({
        userId: z.string().openapi({ description: "The user id of whoever invited.", example: "8yW1kQfV0d3sLx9bTq2nZ" }),
        name: z.string().openapi({ description: "Their name.", example: "Ana Souza" }),
      })
      .nullable()
      .openapi({ description: "Who invited; `null` once their account is deleted (the Invitation stays)." }),
    expiresAt: z.iso.datetime().openapi({ description: "When the link stops working, 7 days after it was sent or last resent.", example: "2026-10-31T12:00:00.000Z" }),
    createdAt: z.iso.datetime().openapi({ description: "When the Invitation was created.", example: "2026-10-24T12:00:00.000Z" }),
  })
  .openapi("Invitation");

const CreateInvitation = z
  .object({
    email: z.email().openapi({ description: "The address to invite.", example: "bruno@example.com" }),
    role: z
      .string()
      .openapi({ description: "The role the person will have: any role of the Product but `owner`.", example: "employee" }),
  })
  .openapi("CreateInvitation");

const InvitationPage = pageOf(Invitation, "InvitationPage");

const InvitationParams = CompanyParams.extend({
  invitationId: z.string().openapi({ description: "The Invitation's id.", example: "6d0b9f3a-2c4e-4f1a-8b7d-1e2f3a4b5c6d" }),
});

const invitationNotFound = errorResponse(
  "No such Company or pending Invitation, or the signed-in user is not one of the Company's Members.",
  "NOT_FOUND",
);

const createInvitationRoute = createRoute({
  method: "post",
  path: "/companies/{companyId}/invitations",
  operationId: "createInvitation",
  summary: "Invite someone to a Company",
  description:
    "The Owner invites an email address to the Company with a role (never `owner`). The Invitation lasts 7 days, and an email with its link goes to the address. Refused with 409 when the address is already a Member, already has a pending Invitation (resend that one instead), or the Owner has no free Seat: remove someone, cancel an Invitation or upgrade the Plan (`NO_FREE_SEAT`; only where billing is on).",
  middleware: [requireIdentity, requireMember, requireOwner] as const,
  request: {
    params: CompanyParams,
    body: { required: true, content: { "application/json": { schema: CreateInvitation } } },
  },
  responses: {
    201: { description: "The pending Invitation.", content: { "application/json": { schema: Invitation } } },
    400: errorResponse("The email is not valid, or the role is `owner` or not one of the Product's.", "VALIDATION_FAILED"),
    401: unauthenticatedResponse,
    403: forbiddenResponse,
    404: companyNotFoundResponse,
    409: errorResponse(
      "The address is already a Member (`ALREADY_A_MEMBER`), already has a pending Invitation to the Company (`INVITATION_PENDING`), or the Owner has no free Seat (`NO_FREE_SEAT`).",
      "ALREADY_A_MEMBER",
      "INVITATION_PENDING",
      "NO_FREE_SEAT",
    ),
  },
});

const listInvitations = createRoute({
  method: "get",
  path: "/companies/{companyId}/invitations",
  operationId: "listInvitations",
  summary: "List a Company's pending Invitations",
  description:
    "The Owner sees the Company's pending Invitations (email, role, who invited and when it expires), oldest first, accepted and canceled ones left out: a page of `limit` (50 by default) and the `nextCursor` of the next page.",
  middleware: [requireIdentity, requireMember, requireOwner] as const,
  request: { params: CompanyParams, query: PageQuery },
  responses: {
    200: { description: "A page of pending Invitations.", content: { "application/json": { schema: InvitationPage } } },
    400: errorResponse("`limit` is out of range, or `cursor` is not one this list answered.", "VALIDATION_FAILED"),
    401: unauthenticatedResponse,
    403: forbiddenResponse,
    404: companyNotFoundResponse,
  },
});

const resendInvitationRoute = createRoute({
  method: "post",
  path: "/companies/{companyId}/invitations/{invitationId}/resend",
  operationId: "resendInvitation",
  summary: "Resend a pending Invitation",
  description:
    "The Owner sends a pending Invitation again, with a new link (the previous one stops working) that lasts 7 more days. Works on an expired Invitation too.",
  middleware: [requireIdentity, requireMember, requireOwner] as const,
  request: { params: InvitationParams },
  responses: {
    200: { description: "The renewed Invitation.", content: { "application/json": { schema: Invitation } } },
    401: unauthenticatedResponse,
    403: forbiddenResponse,
    404: invitationNotFound,
  },
});

const cancelInvitation = createRoute({
  method: "delete",
  path: "/companies/{companyId}/invitations/{invitationId}",
  operationId: "cancelInvitation",
  summary: "Cancel a pending Invitation",
  description: "The Owner cancels a pending Invitation: its link stops working and it leaves the pending list.",
  middleware: [requireIdentity, requireMember, requireOwner] as const,
  request: { params: InvitationParams },
  responses: {
    204: { description: "The Invitation is canceled." },
    401: unauthenticatedResponse,
    403: forbiddenResponse,
    404: invitationNotFound,
  },
});

const TokenParams = z.object({
  token: z.string().openapi({ description: "The secret of the Invitation's link, from its email.", example: "q3Xv0b6n2kT9mWcR1sYfLh8pJzA4dGuE7iNoBxVtKe5" }),
});

const InvitationByToken = z
  .object({
    companyId: z.string().openapi({ description: "The Company the person is invited to.", example: "2f1c6a0e-8d1b-4a51-9f3e-6b0c1d2e3f40" }),
    companyName: z.string().openapi({ description: "Its name.", example: "Acme" }),
    email: z.email().openapi({ description: "The invited address: only a user with it may accept.", example: "bruno@example.com" }),
    role: z.string().openapi({ description: "The role the person will have.", example: "employee" }),
    expiresAt: z.iso.datetime().openapi({ description: "When the link stops working.", example: "2026-10-31T12:00:00.000Z" }),
    alreadyMember: z
      .boolean()
      .openapi({ description: "Whether the signed-in user is already a Member of the Company (`false` without a session)." }),
  })
  .openapi("InvitationByToken");

const invitationGone = errorResponse("The Invitation was accepted, canceled or has expired.", "INVITATION_EXPIRED");
const unknownToken = errorResponse("No Invitation has this link.", "NOT_FOUND");

const getInvitationByToken = createRoute({
  method: "get",
  path: "/invitations/{token}",
  operationId: "getInvitationByToken",
  summary: "See the Invitation of a link",
  description:
    "Answers what the link of an Invitation email invites to (the Company, the role and the invited address), to anyone who has the link, signed in or not. Answers 410 once the Invitation is accepted, canceled or expired, unless the signed-in user is already a Member of the Company.",
  // The link is a secret of the invited person's browser, not something an agent acts on.
  "x-mcp": false,
  request: { params: TokenParams },
  responses: {
    200: { description: "The Invitation.", content: { "application/json": { schema: InvitationByToken } } },
    404: unknownToken,
    410: invitationGone,
  },
});

const acceptInvitationRoute = createRoute({
  method: "post",
  path: "/invitations/{token}/accept",
  operationId: "acceptInvitation",
  summary: "Accept an Invitation",
  description:
    "The signed-in user, whose email must be the invited address, becomes a Member of the Company with the Invitation's role, and the Invitation leaves the pending list. Answers the Company. A user who is already a Member gets the Company, and nothing changes. Refused with 409 `NO_FREE_SEAT` when the Owner has no free Seat (only where billing is on).",
  "x-mcp": false,
  middleware: [requireIdentity] as const,
  request: { params: TokenParams },
  responses: {
    200: { description: "The Company the user is a Member of, with their role.", content: { "application/json": { schema: Company } } },
    401: unauthenticatedResponse,
    403: errorResponse("The signed-in user's email is not the invited address.", "INVITATION_EMAIL_MISMATCH"),
    404: unknownToken,
    409: errorResponse("The Company's Owner has no free Seat (`NO_FREE_SEAT`).", "NO_FREE_SEAT"),
    410: invitationGone,
  },
});

export const invitationsApi = createRouter()
  .openapi(createInvitationRoute, async (c) => {
    const result = await createInvitation(c, c.req.valid("json"));
    if ("invitation" in result) return c.json(result.invitation, 201);
    if (result.refused === "VALIDATION_FAILED") return c.json(apiError(result.refused), 400);
    return c.json(apiError(result.refused), 409);
  })
  .openapi(listInvitations, async (c) => {
    const { limit, cursor } = c.req.valid("query");
    const position = cursorPosition(cursor);
    if (position === null) return c.json(apiError("VALIDATION_FAILED"), 400);
    const rows = await c.var.db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        invitedBy: invitations.invitedBy,
        inviterName: users.name,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(
        and(
          eq(invitations.companyId, c.var.member.companyId),
          pending,
          afterPosition(position, invitations.createdAt, invitations.id),
        ),
      )
      .orderBy(asc(invitations.createdAt), asc(invitations.id))
      .limit(limit + 1);
    return c.json(toPage(rows, limit, { item: toInvitation, position: (row) => ({ at: row.createdAt, id: row.id }) }), 200);
  })
  .openapi(resendInvitationRoute, async (c) => {
    const invitation = await resendInvitation(c, c.req.valid("param").invitationId);
    if (!invitation) return c.json(apiError("NOT_FOUND"), 404);
    return c.json(invitation, 200);
  })
  .openapi(cancelInvitation, async (c) => {
    const [canceled] = await c.var.db
      .update(invitations)
      .set({ canceledAt: new Date() })
      .where(and(eq(invitations.id, c.req.valid("param").invitationId), eq(invitations.companyId, c.var.member.companyId), pending))
      .returning({ id: invitations.id });
    if (!canceled) return c.json(apiError("NOT_FOUND"), 404);
    return c.body(null, 204);
  })
  .openapi(getInvitationByToken, async (c) => {
    const identity = await resolveIdentity(c);
    const result = await invitationByToken(c, c.req.valid("param").token, identity?.user.id ?? null);
    if ("invitation" in result) return c.json(result.invitation, 200);
    if (result.refused === "NOT_FOUND") return c.json(apiError(result.refused), 404);
    return c.json(apiError(result.refused), 410);
  })
  .openapi(acceptInvitationRoute, async (c) => {
    const result = await acceptInvitation(c, c.req.valid("param").token);
    if ("company" in result) return c.json(toCompany(result.company), 200);
    if (result.refused === "NOT_FOUND") return c.json(apiError(result.refused), 404);
    if (result.refused === "INVITATION_EMAIL_MISMATCH") return c.json(apiError(result.refused), 403);
    if (result.refused === "NO_FREE_SEAT") return c.json(apiError(result.refused), 409);
    return c.json(apiError(result.refused), 410);
  });
