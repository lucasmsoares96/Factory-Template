import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { companies, memberRoles, members, users } from "../../db/schema.ts";
import { apiError, createRouter, errorResponse } from "../../platform/errors.ts";
import { emitCompanyDeleting, emitMemberJoined } from "../../platform/feature.ts";
import { requireIdentity, unauthenticatedResponse } from "../../platform/identity.ts";
import {
  CompanyParams,
  companyNotFoundResponse,
  forbiddenResponse,
  requireMember,
  requireOwner,
  skeletonRole,
} from "../../platform/member.ts";
import { PageQuery, afterPosition, cursorPosition, pageOf, toPage } from "../../platform/pagination.ts";

const role = z.string().openapi({
  description: "The Member's role: `owner`, `employee`, or a role the Product adds.",
  example: "owner",
});

export const Company = z
  .object({
    id: z.string().openapi({ description: "The Company's id: random, and it never changes.", example: "2f1c6a0e-8d1b-4a51-9f3e-6b0c1d2e3f40" }),
    name: z.string().openapi({ description: "The Company's name; several Companies may share it.", example: "Acme" }),
    role: role.openapi({ description: "The signed-in user's role in the Company." }),
    createdAt: z.iso.datetime().openapi({ description: "When the Company was created.", example: "2026-10-24T12:00:00.000Z" }),
  })
  .openapi("Company");

const companyName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .openapi({ description: "The Company's name: 1 to 100 characters once the spaces around it are removed.", example: "Acme" });

const CreateCompany = z.object({ name: companyName }).openapi("CreateCompany");

const RenameCompany = z.object({ name: companyName }).openapi("RenameCompany");

/** The Company's current name, typed by the Owner to confirm an action only a person may take. */
const confirmationName = z.string().trim().openapi({
  description: "The Company's current name, typed to confirm (the spaces around it are removed).",
  example: "Acme",
});

const DeleteCompany = z.object({ name: confirmationName }).openapi("DeleteCompany");

const TransferOwnership = z
  .object({
    userId: z.string().openapi({ description: "The user id of the Member who becomes the Owner.", example: "8yW1kQfV0d3sLx9bTq2nZ" }),
    name: confirmationName,
  })
  .openapi("TransferOwnership");

const CompanyPage = pageOf(Company, "CompanyPage");

const CompanyMember = z
  .object({
    userId: z.string().openapi({ description: "The Member's user id.", example: "8yW1kQfV0d3sLx9bTq2nZ" }),
    name: z.string().openapi({ description: "The Member's name.", example: "Ana Souza" }),
    email: z.email().openapi({ description: "The Member's email.", example: "ana@example.com" }),
    role,
  })
  .openapi("CompanyMember");

const CompanyMemberPage = pageOf(CompanyMember, "CompanyMemberPage");

const invalidCursor = "`limit` is out of range, or `cursor` is not one this list answered.";

const createCompany = createRoute({
  method: "post",
  path: "/companies",
  operationId: "createCompany",
  summary: "Create a Company",
  description:
    "Creates a Company with this name (the spaces around it are removed; names may repeat) and makes the signed-in user its Owner. Answers the new Company.",
  middleware: [requireIdentity] as const,
  request: { body: { required: true, content: { "application/json": { schema: CreateCompany } } } },
  responses: {
    201: { description: "The new Company, with the role `owner`.", content: { "application/json": { schema: Company } } },
    400: errorResponse("The name is missing, blank or longer than 100 characters.", "VALIDATION_FAILED"),
    401: unauthenticatedResponse,
  },
});

const listCompanies = createRoute({
  method: "get",
  path: "/companies",
  operationId: "listCompanies",
  summary: "List the signed-in user's Companies",
  description:
    "Answers the Companies the signed-in user is a Member of, with their role in each, in the order they joined: a page of `limit` (50 by default) and the `nextCursor` of the next page.",
  middleware: [requireIdentity] as const,
  request: { query: PageQuery },
  responses: {
    200: { description: "A page of the user's Companies.", content: { "application/json": { schema: CompanyPage } } },
    400: errorResponse(invalidCursor, "VALIDATION_FAILED"),
    401: unauthenticatedResponse,
  },
});

const getLastCompany = createRoute({
  method: "get",
  path: "/me/last-company",
  operationId: "getLastCompany",
  summary: "Get the Company the signed-in user used last",
  description:
    "Answers the Company the signed-in user last opened in the app or, if they never opened one, the first they joined. Answers 404 when they are a Member of no Company.",
  middleware: [requireIdentity] as const,
  responses: {
    200: { description: "The Company to land on.", content: { "application/json": { schema: Company } } },
    401: unauthenticatedResponse,
    404: errorResponse("The signed-in user is a Member of no Company.", "NOT_FOUND"),
  },
});

const getCompany = createRoute({
  method: "get",
  path: "/companies/{companyId}",
  operationId: "getCompany",
  summary: "Get a Company",
  description:
    "Answers a Company the signed-in user is a Member of, with their role. Opened from the app (not by an agent), it becomes the Company they land on next time.",
  middleware: [requireIdentity, requireMember] as const,
  request: { params: CompanyParams },
  responses: {
    200: { description: "The Company.", content: { "application/json": { schema: Company } } },
    401: unauthenticatedResponse,
    404: companyNotFoundResponse,
  },
});

const listMembers = createRoute({
  method: "get",
  path: "/companies/{companyId}/members",
  operationId: "listMembers",
  summary: "List a Company's Members",
  description:
    "Answers the Members of a Company the signed-in user belongs to (name, email and role), in the order they joined: a page of `limit` (50 by default) and the `nextCursor` of the next page.",
  middleware: [requireIdentity, requireMember] as const,
  request: { params: CompanyParams, query: PageQuery },
  responses: {
    200: { description: "A page of the Company's Members.", content: { "application/json": { schema: CompanyMemberPage } } },
    400: errorResponse(invalidCursor, "VALIDATION_FAILED"),
    401: unauthenticatedResponse,
    404: companyNotFoundResponse,
  },
});

const renameCompany = createRoute({
  method: "patch",
  path: "/companies/{companyId}",
  operationId: "renameCompany",
  summary: "Rename a Company",
  description:
    "Gives a Company a new name (the spaces around it are removed; names may repeat). Only its Owner may. The id, and so every link to the Company, stays the same. Answers the renamed Company.",
  middleware: [requireIdentity, requireMember, requireOwner] as const,
  request: {
    params: CompanyParams,
    body: { required: true, content: { "application/json": { schema: RenameCompany } } },
  },
  responses: {
    200: { description: "The renamed Company.", content: { "application/json": { schema: Company } } },
    400: errorResponse("The name is missing, blank or longer than 100 characters.", "VALIDATION_FAILED"),
    401: unauthenticatedResponse,
    403: forbiddenResponse,
    404: companyNotFoundResponse,
  },
});

const deleteCompany = createRoute({
  method: "delete",
  path: "/companies/{companyId}",
  operationId: "deleteCompany",
  summary: "Delete a Company",
  description:
    "Deletes a Company for good, right away, with everything in it: every feature's `companyDeleting` runs first, in the Product's order, then the Company and its Members are deleted. Only its Owner may, confirming with the Company's current name. Its former Members get 404 on it from then on.",
  // Deleting a Company needs a person's confirmation: never an agent's call.
  "x-mcp": false,
  middleware: [requireIdentity, requireMember, requireOwner] as const,
  request: {
    params: CompanyParams,
    body: { required: true, content: { "application/json": { schema: DeleteCompany } } },
  },
  responses: {
    204: { description: "The Company and its Members are gone." },
    400: errorResponse(
      "The confirmation is missing (`VALIDATION_FAILED`), or is not the Company's current name (`CONFIRMATION_MISMATCH`).",
      "VALIDATION_FAILED",
      "CONFIRMATION_MISMATCH",
    ),
    401: unauthenticatedResponse,
    403: forbiddenResponse,
    404: companyNotFoundResponse,
  },
});

const transferOwnership = createRoute({
  method: "post",
  path: "/companies/{companyId}/transfer-ownership",
  operationId: "transferOwnership",
  summary: "Transfer a Company's ownership",
  description:
    "Makes another Member the Company's Owner, without them having to accept, and its Owner an Employee, in one step: the Company always has exactly one Owner. Only its Owner may, confirming with the Company's current name. Answers the Company with the caller's new role, `employee`.",
  // Giving a Company away needs a person's confirmation: never an agent's call.
  "x-mcp": false,
  middleware: [requireIdentity, requireMember, requireOwner] as const,
  request: {
    params: CompanyParams,
    body: { required: true, content: { "application/json": { schema: TransferOwnership } } },
  },
  responses: {
    200: { description: "The Company, with the caller's new role `employee`.", content: { "application/json": { schema: Company } } },
    400: errorResponse(
      "The recipient or the confirmation is missing, or the recipient is the Owner themself (`VALIDATION_FAILED`), or the confirmation is not the Company's current name (`CONFIRMATION_MISMATCH`).",
      "VALIDATION_FAILED",
      "CONFIRMATION_MISMATCH",
    ),
    401: unauthenticatedResponse,
    403: forbiddenResponse,
    404: errorResponse("No such Company, the signed-in user is not one of its Members, or the recipient is not one.", "NOT_FOUND"),
  },
});

const MemberParams = CompanyParams.extend({
  userId: z.string().openapi({ description: "The Member's user id.", example: "8yW1kQfV0d3sLx9bTq2nZ" }),
});

const ChangeMemberRole = z
  .object({
    role: z.string().openapi({ description: "The new role: any role of the Product but `owner`.", example: "employee" }),
  })
  .openapi("ChangeMemberRole");

const memberNotFound = errorResponse(
  "No such Company, or the signed-in user is not one of its Members, or the user of the path is not.",
  "NOT_FOUND",
);

const ownerMustTransfer = errorResponse(
  "The Owner cannot leave the Company: they transfer its ownership to another Member first.",
  "OWNER_MUST_TRANSFER",
);

const changeMemberRole = createRoute({
  method: "patch",
  path: "/companies/{companyId}/members/{userId}",
  operationId: "changeMemberRole",
  summary: "Change a Member's role",
  description:
    "The Owner gives another Member a new role: any role of the Product but `owner`. Nobody changes their own role (`OWN_ROLE`). Answers the Member with the new role.",
  middleware: [requireIdentity, requireMember, requireOwner] as const,
  request: {
    params: MemberParams,
    body: { required: true, content: { "application/json": { schema: ChangeMemberRole } } },
  },
  responses: {
    200: { description: "The Member, with the new role.", content: { "application/json": { schema: CompanyMember } } },
    400: errorResponse("The role is missing, `owner`, or not one of the Product's.", "VALIDATION_FAILED"),
    401: unauthenticatedResponse,
    403: errorResponse(
      "The signed-in user is not the Owner (`FORBIDDEN`), or the Member is the signed-in user (`OWN_ROLE`).",
      "FORBIDDEN",
      "OWN_ROLE",
    ),
    404: memberNotFound,
  },
});

const removeMember = createRoute({
  method: "delete",
  path: "/companies/{companyId}/members/{userId}",
  operationId: "removeMember",
  summary: "Remove a Member from a Company",
  description:
    "The Owner removes another Member from the Company. From the next call on, the removed user gets 404 on every route of the Company, their agents included. The Owner cannot remove themselves (`OWNER_MUST_TRANSFER`).",
  middleware: [requireIdentity, requireMember, requireOwner] as const,
  request: { params: MemberParams },
  responses: {
    204: { description: "The user is no longer a Member." },
    401: unauthenticatedResponse,
    403: forbiddenResponse,
    404: memberNotFound,
    409: ownerMustTransfer,
  },
});

const leaveCompany = createRoute({
  method: "post",
  path: "/companies/{companyId}/leave",
  operationId: "leaveCompany",
  summary: "Leave a Company",
  description:
    "The signed-in user stops being a Member of the Company. From the next call on, they get 404 on every route of the Company, their agents included. The Owner cannot leave before transferring the ownership (`OWNER_MUST_TRANSFER`).",
  middleware: [requireIdentity, requireMember] as const,
  request: { params: CompanyParams },
  responses: {
    204: { description: "The signed-in user is no longer a Member." },
    401: unauthenticatedResponse,
    404: companyNotFoundResponse,
    409: ownerMustTransfer,
  },
});

/** The Member `userId` of the Company, unless they are its Owner: the one Member nobody removes or changes. */
const notTheOwner = (companyId: string, userId: string) =>
  and(eq(members.companyId, companyId), eq(members.userId, userId), ne(members.role, "owner"));

/** What a Company row is answered as. */
const companyColumns = { id: companies.id, name: companies.name, createdAt: companies.createdAt, role: members.role };

export function toCompany(row: { id: string; name: string; createdAt: Date; role: string }) {
  return { id: row.id, name: row.name, role: row.role, createdAt: row.createdAt.toISOString() };
}

export const companiesApi = createRouter()
  .openapi(createCompany, async (c) => {
    const { name } = c.req.valid("json");
    const userId = c.var.identity.user.id;
    const company = await c.var.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(companies)
        .values({ name })
        .returning({ id: companies.id, name: companies.name, createdAt: companies.createdAt });
      await tx.insert(members).values({ companyId: created!.id, userId, role: "owner" });
      return created!;
    });
    await emitMemberJoined(c.var.features, { db: c.var.db, companyId: company.id, userId });
    return c.json(toCompany({ ...company, role: "owner" }), 201);
  })
  .openapi(listCompanies, async (c) => {
    const { limit, cursor } = c.req.valid("query");
    const position = cursorPosition(cursor);
    if (position === null) return c.json(apiError("VALIDATION_FAILED"), 400);
    const rows = await c.var.db
      .select({ ...companyColumns, joinedAt: members.createdAt })
      .from(members)
      .innerJoin(companies, eq(companies.id, members.companyId))
      .where(and(eq(members.userId, c.var.identity.user.id), afterPosition(position, members.createdAt, members.companyId)))
      .orderBy(asc(members.createdAt), asc(members.companyId))
      .limit(limit + 1);
    return c.json(toPage(rows, limit, { item: toCompany, position: (row) => ({ at: row.joinedAt, id: row.id }) }), 200);
  })
  .openapi(getLastCompany, async (c) => {
    const [company] = await c.var.db
      .select(companyColumns)
      .from(members)
      .innerJoin(companies, eq(companies.id, members.companyId))
      .where(eq(members.userId, c.var.identity.user.id))
      .orderBy(sql`${members.lastUsedAt} desc nulls last`, asc(members.createdAt), asc(members.companyId))
      .limit(1);
    if (!company) return c.json(apiError("NOT_FOUND"), 404);
    return c.json(toCompany(company), 200);
  })
  .openapi(getCompany, async (c) => {
    const { companyId, userId, role } = c.var.member;
    const [company] = await c.var.db
      .select({ id: companies.id, name: companies.name, createdAt: companies.createdAt })
      .from(companies)
      .where(eq(companies.id, companyId));
    // Deleted after `requireMember` found the Member.
    if (!company) return c.json(apiError("NOT_FOUND"), 404);
    // Only the app's own navigation says where the user works; an agent's reads do not.
    if (c.var.identity.via === "session") {
      await c.var.db
        .update(members)
        .set({ lastUsedAt: new Date() })
        .where(and(eq(members.companyId, companyId), eq(members.userId, userId)));
    }
    return c.json(toCompany({ ...company, role }), 200);
  })
  .openapi(listMembers, async (c) => {
    const { limit, cursor } = c.req.valid("query");
    const position = cursorPosition(cursor);
    if (position === null) return c.json(apiError("VALIDATION_FAILED"), 400);
    const rows = await c.var.db
      .select({ userId: users.id, name: users.name, email: users.email, role: members.role, joinedAt: members.createdAt })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(and(eq(members.companyId, c.var.member.companyId), afterPosition(position, members.createdAt, members.userId)))
      .orderBy(asc(members.createdAt), asc(members.userId))
      .limit(limit + 1);
    return c.json(
      toPage(rows, limit, {
        item: ({ userId, name, email, role }) => ({ userId, name, email, role }),
        position: (row) => ({ at: row.joinedAt, id: row.userId }),
      }),
      200,
    );
  })
  .openapi(renameCompany, async (c) => {
    const { name } = c.req.valid("json");
    const [company] = await c.var.db
      .update(companies)
      .set({ name })
      .where(eq(companies.id, c.var.member.companyId))
      .returning({ id: companies.id, name: companies.name, createdAt: companies.createdAt });
    // Deleted after `requireMember` found the Member.
    if (!company) return c.json(apiError("NOT_FOUND"), 404);
    return c.json(toCompany({ ...company, role: c.var.member.role }), 200);
  })
  .openapi(deleteCompany, async (c) => {
    const { companyId } = c.var.member;
    const { name } = c.req.valid("json");
    // One transaction: a hook that throws leaves the Company and everything in it,
    // and the row lock keeps a concurrent rename from slipping past the confirmation.
    const outcome = await c.var.db.transaction(async (tx) => {
      const [company] = await tx.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).for("update");
      // Deleted after `requireMember` found the Member.
      if (!company) return "NOT_FOUND";
      if (name !== company.name) return "CONFIRMATION_MISMATCH";
      await emitCompanyDeleting(c.var.features, { db: tx, companyId });
      // The Members go with it (`ON DELETE CASCADE`).
      await tx.delete(companies).where(eq(companies.id, companyId));
      return "DELETED";
    });
    if (outcome === "NOT_FOUND") return c.json(apiError("NOT_FOUND"), 404);
    if (outcome === "CONFIRMATION_MISMATCH") return c.json(apiError("CONFIRMATION_MISMATCH"), 400);
    return c.body(null, 204);
  })
  .openapi(transferOwnership, async (c) => {
    const { companyId, userId } = c.var.member;
    const { userId: recipientId, name } = c.req.valid("json");
    if (recipientId === userId) return c.json(apiError("VALIDATION_FAILED"), 400);
    // One transaction, so the Company never has two Owners or none. The row lock
    // queues a concurrent transfer or rename behind this one, which then reads
    // the roles and the name as they are after it.
    const outcome = await c.var.db.transaction(async (tx) => {
      const [company] = await tx
        .select({ id: companies.id, name: companies.name, createdAt: companies.createdAt })
        .from(companies)
        .where(eq(companies.id, companyId))
        .for("update");
      // Deleted after `requireMember` found the Member.
      if (!company) return "NOT_FOUND" as const;
      const roles = await tx
        .select({ userId: members.userId, role: members.role })
        .from(members)
        .where(and(eq(members.companyId, companyId), inArray(members.userId, [userId, recipientId])))
        // Neither can leave, or be removed, halfway through.
        .for("update");
      const caller = roles.find((member) => member.userId === userId);
      // A transfer that went first made the caller an Employee, or they left.
      if (!caller) return "NOT_FOUND" as const;
      if (skeletonRole(caller.role) !== "owner") return "FORBIDDEN" as const;
      if (name !== company.name) return "CONFIRMATION_MISMATCH" as const;
      if (!roles.some((member) => member.userId === recipientId)) return "NOT_FOUND" as const;
      // The former Owner steps down first: the database allows one Owner per Company.
      await tx.update(members).set({ role: "employee" }).where(and(eq(members.companyId, companyId), eq(members.userId, userId)));
      await tx.update(members).set({ role: "owner" }).where(and(eq(members.companyId, companyId), eq(members.userId, recipientId)));
      return company;
    });
    if (outcome === "NOT_FOUND") return c.json(apiError("NOT_FOUND"), 404);
    if (outcome === "FORBIDDEN") return c.json(apiError("FORBIDDEN"), 403);
    if (outcome === "CONFIRMATION_MISMATCH") return c.json(apiError("CONFIRMATION_MISMATCH"), 400);
    return c.json(toCompany({ ...outcome, role: "employee" }), 200);
  })
  .openapi(changeMemberRole, async (c) => {
    const { companyId, userId: callerId } = c.var.member;
    const { userId } = c.req.valid("param");
    const { role } = c.req.valid("json");
    if (userId === callerId) return c.json(apiError("OWN_ROLE"), 403);
    const [known] = await c.var.db.select({ id: memberRoles.id }).from(memberRoles).where(eq(memberRoles.id, role));
    if (!known || role === "owner") return c.json(apiError("VALIDATION_FAILED"), 400);
    // The Owner is the caller, so the Member changed is never the Owner.
    const [changed] = await c.var.db
      .update(members)
      .set({ role })
      .where(notTheOwner(companyId, userId))
      .returning({ userId: members.userId });
    if (!changed) return c.json(apiError("NOT_FOUND"), 404);
    const [member] = await c.var.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
    return c.json({ userId, name: member!.name, email: member!.email, role }, 200);
  })
  .openapi(removeMember, async (c) => {
    const { companyId, userId: callerId } = c.var.member;
    const { userId } = c.req.valid("param");
    if (userId === callerId) return c.json(apiError("OWNER_MUST_TRANSFER"), 409);
    // No Connection is revoked: `requireMember` refuses the user's agents on their next call.
    const [removed] = await c.var.db
      .delete(members)
      .where(notTheOwner(companyId, userId))
      .returning({ userId: members.userId });
    if (!removed) return c.json(apiError("NOT_FOUND"), 404);
    return c.body(null, 204);
  })
  .openapi(leaveCompany, async (c) => {
    const { companyId, userId, role } = c.var.member;
    if (role === "owner") return c.json(apiError("OWNER_MUST_TRANSFER"), 409);
    const [left] = await c.var.db
      .delete(members)
      .where(notTheOwner(companyId, userId))
      .returning({ userId: members.userId });
    // Removed after `requireMember` found the Member.
    if (!left) return c.json(apiError("NOT_FOUND"), 404);
    return c.body(null, 204);
  });
