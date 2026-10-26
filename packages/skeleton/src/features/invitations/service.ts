import { and, eq, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { companies, invitations, memberRoles, members, users } from "../../db/schema.ts";
import { invitationEmail } from "../../emails/invitation.tsx";
import type { SkeletonEnv } from "../../platform/env.ts";

/** How long an Invitation's link works, from its creation or its last resend. */
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** An Invitation as the API answers it. */
export type Invitation = {
  id: string;
  email: string;
  role: string;
  /** Who invited, or `null` once their account is deleted. */
  invitedBy: { userId: string; name: string } | null;
  expiresAt: string;
  createdAt: string;
};

/** Why `createInvitation` refused: a 400 for an unknown or `owner` role, a 409 for the others. */
export type InvitationRefusal = "VALIDATION_FAILED" | "ALREADY_A_MEMBER" | "INVITATION_PENDING";

export type CreateInvitationResult = { invitation: Invitation } | { refused: InvitationRefusal };

/**
 * Invites `email` to the Company of the path with `role`, in the name of the
 * signed-in user, and sends the email with its link. Exported so a Product's
 * route under `/api/companies/{companyId}/...` builds Invitations with rules of
 * its own (who may invite, a Team to join later) and reuses this validation,
 * token and email. It does not check the caller's role: the route does. Call it
 * after `requireIdentity` and `requireMember`.
 *
 * Refuses (`refused`) a role that is `owner` or not in `member_roles`
 * (`VALIDATION_FAILED`), an address that is already a Member (`ALREADY_A_MEMBER`)
 * and one with a pending Invitation to the Company (`INVITATION_PENDING`).
 */
export async function createInvitation(
  c: Context<SkeletonEnv>,
  input: { email: string; role: string },
): Promise<CreateInvitationResult> {
  const { db } = c.var;
  const { companyId } = c.var.member;
  const inviter = c.var.identity.user;
  const email = input.email.trim().toLowerCase();
  const { role } = input;

  const [known] = await db.select({ id: memberRoles.id }).from(memberRoles).where(eq(memberRoles.id, role));
  if (!known || role === "owner") return { refused: "VALIDATION_FAILED" };
  const [member] = await db
    .select({ userId: members.userId })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.companyId, companyId), sql`lower(${users.email}) = ${email}`));
  if (member) return { refused: "ALREADY_A_MEMBER" };

  const token = newToken();
  const [created] = await db
    .insert(invitations)
    .values({
      companyId,
      email,
      role,
      invitedBy: inviter.id,
      tokenHash: await hashToken(token),
      expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
    })
    .onConflictDoNothing()
    .returning();
  if (!created) return { refused: "INVITATION_PENDING" };

  try {
    await sendInvitationEmail(c, { email, role, inviterName: inviter.name, token });
  } catch (error) {
    // An Invitation whose email never left would block the address with INVITATION_PENDING.
    await db.delete(invitations).where(eq(invitations.id, created.id));
    throw error;
  }
  return { invitation: toInvitation({ ...created, inviterName: inviter.name }) };
}

/**
 * Renews a pending Invitation of the Company of the path: a new link (the old
 * one stops working) valid for 7 more days, sent again. Answers `null` when the
 * Company has no such pending Invitation.
 */
export async function resendInvitation(c: Context<SkeletonEnv>, invitationId: string): Promise<Invitation | null> {
  const token = newToken();
  const [renewed] = await c.var.db
    .update(invitations)
    .set({ tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS) })
    .where(and(eq(invitations.id, invitationId), eq(invitations.companyId, c.var.member.companyId), pending))
    .returning();
  if (!renewed) return null;
  const [inviter] = renewed.invitedBy
    ? await c.var.db.select({ name: users.name }).from(users).where(eq(users.id, renewed.invitedBy))
    : [];
  // The email names whoever invited; with that account gone, whoever resends.
  const inviterName = inviter?.name ?? c.var.identity.user.name;
  await sendInvitationEmail(c, { email: renewed.email, role: renewed.role, inviterName, token });
  return toInvitation({ ...renewed, inviterName: inviter?.name ?? null });
}

/** Neither accepted nor canceled. An expired Invitation is still pending: resending renews it. */
export const pending = and(isNull(invitations.acceptedAt), isNull(invitations.canceledAt));

export function toInvitation(row: {
  id: string;
  email: string;
  role: string;
  invitedBy: string | null;
  inviterName: string | null;
  expiresAt: Date;
  createdAt: Date;
}): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    invitedBy: row.invitedBy && row.inviterName !== null ? { userId: row.invitedBy, name: row.inviterName } : null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

async function sendInvitationEmail(
  c: Context<SkeletonEnv>,
  { email, role, inviterName, token }: { email: string; role: string; inviterName: string; token: string },
) {
  const { t } = c.var;
  const [company] = await c.var.db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, c.var.member.companyId));
  const roleName = Object.hasOwn(t.companies.roles, role) ? t.companies.roles[role as keyof typeof t.companies.roles] : role;
  await c.var.sendEmail(
    await invitationEmail({
      t,
      to: email,
      companyName: company?.name ?? "",
      inviterName,
      role: roleName,
      url: `${new URL(c.req.url).origin}/invitations/${token}`,
    }),
  );
}

/** The link's secret: 32 random bytes, base64url. Only its hash is stored. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** The SHA-256 of a token, in hex: what the database keeps to find an Invitation by its link. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
