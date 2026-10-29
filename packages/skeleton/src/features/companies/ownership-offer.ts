import { createRoute, z } from "@hono/zod-openapi";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { companies, invitations, members, ownershipOffers, users } from "../../db/schema.ts";
import { ownershipOfferEmail } from "../../emails/ownership-offer.tsx";
import { apiError, createRouter, errorResponse } from "../../platform/errors.ts";
import { seatLimitOf } from "../../platform/feature.ts";
import { requireIdentity, unauthenticatedResponse } from "../../platform/identity.ts";
import { CompanyParams, forbiddenResponse, requireMember, requireOwner, skeletonRole } from "../../platform/member.ts";
import { countSeats, lockSeats, seatPeople } from "../../platform/seats.ts";
import { Company, toCompany } from "./api.ts";

/** How long an ownership offer lasts, from its creation. */
export const OWNERSHIP_OFFER_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const OwnershipOffer = z
  .object({
    id: z.string().openapi({ description: "The offer's id.", example: "6d0b9f3a-2c4e-4f1a-8b7d-1e2f3a4b5c6d" }),
    recipient: z
      .object({
        userId: z.string().openapi({ description: "The user id of the Member the Company is offered to.", example: "8yW1kQfV0d3sLx9bTq2nZ" }),
        name: z.string().openapi({ description: "Their name.", example: "Bruno Lima" }),
        email: z.email().openapi({ description: "Their email.", example: "bruno@example.com" }),
      })
      .openapi({ description: "Who the Company is offered to." }),
    offeredBy: z
      .object({
        userId: z.string().openapi({ description: "The user id of the Owner who offered.", example: "2yW1kQfV0d3sLx9bTq2nZ" }),
        name: z.string().openapi({ description: "Their name.", example: "Ana Souza" }),
      })
      .nullable()
      .openapi({ description: "The Owner who offered; `null` once their account is deleted." }),
    expiresAt: z.iso.datetime().openapi({ description: "When the offer lapses, 7 days after it was made.", example: "2026-10-31T12:00:00.000Z" }),
    createdAt: z.iso.datetime().openapi({ description: "When the offer was made.", example: "2026-10-24T12:00:00.000Z" }),
  })
  .openapi("OwnershipOffer");

const CreateOwnershipOffer = z
  .object({
    userId: z.string().openapi({ description: "The user id of the Member who is offered the Company.", example: "8yW1kQfV0d3sLx9bTq2nZ" }),
    name: z.string().trim().openapi({
      description: "The Company's current name, typed to confirm (the spaces around it are removed).",
      example: "Acme",
    }),
  })
  .openapi("CreateOwnershipOffer");

const NotEnoughSeats = z
  .object({
    code: z.literal("NOT_ENOUGH_SEATS").openapi({ description: "Stable error code. Clients translate it." }),
    message: z.string().openapi({ description: "English description, for logs and API clients." }),
    missing: z.number().int().positive().openapi({
      description: "How many more free Seats the new Owner needs to take over the Company's people.",
      example: 2,
    }),
  })
  .openapi("NotEnoughSeats");

const offerNotFound = errorResponse(
  "No such Company, the signed-in user is not one of its Members, or there is no open offer for them to see.",
  "NOT_FOUND",
);

// Giving a Company away needs a person's decision: never an agent's call.
const createOffer = createRoute({
  method: "post",
  path: "/companies/{companyId}/ownership-offer",
  operationId: "createOwnershipOffer",
  summary: "Offer a Company's ownership to a Member",
  description:
    "The Owner offers the Company to another Member, confirming with the Company's current name. The Member gets an email and the offer lasts 7 days. Nothing changes until they accept: the Owner stays the Owner and the people stay in the Owner's Seats. A new offer replaces the open one. Answers the offer.",
  "x-mcp": false,
  middleware: [requireIdentity, requireMember, requireOwner] as const,
  request: {
    params: CompanyParams,
    body: { required: true, content: { "application/json": { schema: CreateOwnershipOffer } } },
  },
  responses: {
    201: { description: "The offer.", content: { "application/json": { schema: OwnershipOffer } } },
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

const getOffer = createRoute({
  method: "get",
  path: "/companies/{companyId}/ownership-offer",
  operationId: "getOwnershipOffer",
  summary: "Get the Company's open ownership offer",
  description:
    "Answers the open offer (not accepted, canceled or expired) of the Company's ownership. Only the Owner and the Member it is offered to see it; for anyone else, and when there is none, it answers 404.",
  "x-mcp": false,
  middleware: [requireIdentity, requireMember] as const,
  request: { params: CompanyParams },
  responses: {
    200: { description: "The open offer.", content: { "application/json": { schema: OwnershipOffer } } },
    401: unauthenticatedResponse,
    404: offerNotFound,
  },
});

const cancelOffer = createRoute({
  method: "delete",
  path: "/companies/{companyId}/ownership-offer",
  operationId: "cancelOwnershipOffer",
  summary: "Cancel the Company's ownership offer",
  description: "The Owner withdraws the open offer. Nothing else changes. Answers 404 when there is none.",
  "x-mcp": false,
  middleware: [requireIdentity, requireMember, requireOwner] as const,
  request: { params: CompanyParams },
  responses: {
    204: { description: "The offer was canceled." },
    401: unauthenticatedResponse,
    403: forbiddenResponse,
    404: offerNotFound,
  },
});

const acceptOffer = createRoute({
  method: "post",
  path: "/companies/{companyId}/ownership-offer/accept",
  operationId: "acceptOwnershipOffer",
  summary: "Accept the Company's ownership offer",
  description:
    "The Member the Company is offered to becomes its Owner and the former Owner an Employee, in one step. Refused with 409 `NOT_ENOUGH_SEATS` (and `missing`, how many Seats are short) when the new Owner's free Seats do not cover the Company's people they do not already seat in a Company of theirs; only where billing is on. Answers the Company with the caller's new role, `owner`.",
  "x-mcp": false,
  middleware: [requireIdentity, requireMember] as const,
  request: { params: CompanyParams },
  responses: {
    200: { description: "The Company, with the caller's new role `owner`.", content: { "application/json": { schema: Company } } },
    401: unauthenticatedResponse,
    404: offerNotFound,
    409: { description: "The new Owner has too few free Seats (`NOT_ENOUGH_SEATS`).", content: { "application/json": { schema: NotEnoughSeats } } },
  },
});

/** Neither accepted nor canceled, and not yet expired. */
const open = (companyId: string) =>
  and(
    eq(ownershipOffers.companyId, companyId),
    isNull(ownershipOffers.acceptedAt),
    isNull(ownershipOffers.canceledAt),
    gt(ownershipOffers.expiresAt, new Date()),
  );

type OfferRow = {
  id: string;
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  offeredBy: string | null;
  offererName: string | null;
  expiresAt: Date;
  createdAt: Date;
};

function toOffer(row: OfferRow) {
  return {
    id: row.id,
    recipient: { userId: row.recipientId, name: row.recipientName, email: row.recipientEmail },
    offeredBy: row.offeredBy && row.offererName !== null ? { userId: row.offeredBy, name: row.offererName } : null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export const ownershipOfferApi = createRouter()
  .openapi(createOffer, async (c) => {
    const { companyId, userId } = c.var.member;
    const { userId: recipientId, name } = c.req.valid("json");
    if (recipientId === userId) return c.json(apiError("VALIDATION_FAILED"), 400);
    // The row lock queues a concurrent offer, rename or acceptance behind this one.
    const outcome = await c.var.db.transaction(async (tx) => {
      const [company] = await tx.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).for("update");
      // Deleted after `requireMember` found the Member.
      if (!company) return "NOT_FOUND" as const;
      const roles = await tx
        .select({ userId: members.userId, role: members.role, name: users.name, email: users.email })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(and(eq(members.companyId, companyId), inArray(members.userId, [userId, recipientId])))
        // Neither can leave, or be removed, halfway through.
        .for("update", { of: members });
      const caller = roles.find((member) => member.userId === userId);
      // An acceptance that went first made the caller an Employee, or they left.
      if (!caller) return "NOT_FOUND" as const;
      if (skeletonRole(caller.role) !== "owner") return "FORBIDDEN" as const;
      if (name !== company.name) return "CONFIRMATION_MISMATCH" as const;
      const recipient = roles.find((member) => member.userId === recipientId);
      if (!recipient) return "NOT_FOUND" as const;
      // One offer at a time: the new one replaces the last.
      await tx
        .update(ownershipOffers)
        .set({ canceledAt: new Date() })
        .where(and(eq(ownershipOffers.companyId, companyId), isNull(ownershipOffers.acceptedAt), isNull(ownershipOffers.canceledAt)));
      const [offer] = await tx
        .insert(ownershipOffers)
        .values({ companyId, recipientId, offeredBy: userId, expiresAt: new Date(Date.now() + OWNERSHIP_OFFER_LIFETIME_MS) })
        .returning();
      return { offer: offer!, company, recipient, ownerName: caller.name };
    });
    if (outcome === "NOT_FOUND") return c.json(apiError("NOT_FOUND"), 404);
    if (outcome === "FORBIDDEN") return c.json(apiError("FORBIDDEN"), 403);
    if (outcome === "CONFIRMATION_MISMATCH") return c.json(apiError("CONFIRMATION_MISMATCH"), 400);
    const { offer, company, recipient, ownerName } = outcome;
    try {
      await c.var.sendEmail(
        await ownershipOfferEmail({
          t: c.var.t,
          to: recipient.email,
          companyName: company.name,
          ownerName,
          url: `${new URL(c.req.url).origin}/c/${companyId}`,
        }),
      );
    } catch (error) {
      // An offer whose email never left would sit there unseen.
      await c.var.db.delete(ownershipOffers).where(eq(ownershipOffers.id, offer.id));
      throw error;
    }
    return c.json(
      toOffer({
        id: offer.id,
        recipientId,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        offeredBy: userId,
        offererName: ownerName,
        expiresAt: offer.expiresAt,
        createdAt: offer.createdAt,
      }),
      201,
    );
  })
  .openapi(getOffer, async (c) => {
    const { companyId, userId } = c.var.member;
    const recipients = users;
    const [row] = await c.var.db
      .select({
        id: ownershipOffers.id,
        recipientId: ownershipOffers.recipientId,
        recipientName: recipients.name,
        recipientEmail: recipients.email,
        offeredBy: ownershipOffers.offeredBy,
        offererName: sql<string | null>`(select ${users.name} from ${users} where ${users.id} = ${ownershipOffers.offeredBy})`,
        expiresAt: ownershipOffers.expiresAt,
        createdAt: ownershipOffers.createdAt,
      })
      .from(ownershipOffers)
      .innerJoin(recipients, eq(recipients.id, ownershipOffers.recipientId))
      .where(open(companyId));
    if (!row) return c.json(apiError("NOT_FOUND"), 404);
    // Others in the Company do not learn of it.
    if (skeletonRole(c.var.member.role) !== "owner" && row.recipientId !== userId) return c.json(apiError("NOT_FOUND"), 404);
    return c.json(toOffer(row), 200);
  })
  .openapi(cancelOffer, async (c) => {
    const { companyId } = c.var.member;
    const canceled = await c.var.db
      .update(ownershipOffers)
      .set({ canceledAt: new Date() })
      .where(open(companyId))
      .returning({ id: ownershipOffers.id });
    if (canceled.length === 0) return c.json(apiError("NOT_FOUND"), 404);
    return c.body(null, 204);
  })
  .openapi(acceptOffer, async (c) => {
    const { companyId, userId } = c.var.member;
    const { db } = c.var;
    const limit = await seatLimitOf(c, userId);
    const outcome = await db.transaction(async (tx) => {
      // Same order as an Invitation (the Seats, then the Company), so the two cannot wait on each other.
      const limited = limit !== undefined && limit !== null;
      if (limited) await lockSeats(tx, userId);
      const [company] = await tx
        .select({ id: companies.id, name: companies.name, createdAt: companies.createdAt })
        .from(companies)
        .where(eq(companies.id, companyId))
        .for("update");
      if (!company) return "NOT_FOUND" as const;
      const [offer] = await tx
        .select({ id: ownershipOffers.id })
        .from(ownershipOffers)
        .where(and(open(companyId), eq(ownershipOffers.recipientId, userId)));
      if (!offer) return "NOT_FOUND" as const;
      const roles = await tx
        .select({ userId: members.userId, role: members.role })
        .from(members)
        .where(eq(members.companyId, companyId))
        // Nobody leaves, or is removed, halfway through.
        .for("update");
      const former = roles.find((member) => member.role === "owner");
      if (!former || !roles.some((member) => member.userId === userId)) return "NOT_FOUND" as const;
      if (limited) {
        const held = await seatPeople(tx, userId);
        const inCompany = await tx
          .select({ email: users.email })
          .from(members)
          .innerJoin(users, eq(users.id, members.userId))
          .where(eq(members.companyId, companyId));
        const invited = await tx
          .select({ email: invitations.email })
          .from(invitations)
          .where(and(eq(invitations.companyId, companyId), isNull(invitations.acceptedAt), isNull(invitations.canceledAt)));
        // A person who already holds a Seat in a Company of the new Owner takes no new one.
        const seated = new Set(held.map((person) => person.email.toLowerCase()));
        const needed = new Set([...inCompany, ...invited].map(({ email }) => email.toLowerCase()).filter((email) => !seated.has(email)));
        const missing = needed.size - (limit - countSeats(held));
        if (missing > 0) return { missing };
      }
      // The former Owner steps down first: the database allows one Owner per Company.
      await tx.update(members).set({ role: "employee" }).where(and(eq(members.companyId, companyId), eq(members.userId, former.userId)));
      await tx.update(members).set({ role: "owner", suspendedAt: null }).where(and(eq(members.companyId, companyId), eq(members.userId, userId)));
      await tx.update(ownershipOffers).set({ acceptedAt: new Date() }).where(eq(ownershipOffers.id, offer.id));
      return company;
    });
    if (outcome === "NOT_FOUND") return c.json(apiError("NOT_FOUND"), 404);
    if ("missing" in outcome) return c.json({ ...apiError("NOT_ENOUGH_SEATS"), code: "NOT_ENOUGH_SEATS" as const, missing: outcome.missing }, 409);
    return c.json(toCompany({ ...outcome, role: "owner" }), 200);
  });
