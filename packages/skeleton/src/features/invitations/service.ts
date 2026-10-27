import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { companies, invitations, memberRoles, members, users } from "../../db/schema.ts";
import { invitationEmail } from "../../emails/invitation.tsx";
import type { Database } from "../../platform/db.ts";
import type { SkeletonEnv } from "../../platform/env.ts";
import { emitMemberJoined } from "../../platform/feature.ts";

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

/** An Invitation as its link shows it: what the person is invited to, before they accept. */
export type InvitationByToken = {
  companyId: string;
  companyName: string;
  email: string;
  role: string;
  expiresAt: string;
  /** Whether the signed-in user is already a Member of the Company; `false` without a session. */
  alreadyMember: boolean;
};

/** A Company as `acceptInvitation` answers it: the one the user is now a Member of, with their role. */
export type JoinedCompany = { id: string; name: string; role: string; createdAt: Date };

/** Why the link refuses: 404 for a token no Invitation has, 410 once it is accepted, canceled or expired, 403 for another address. */
export type AcceptRefusal = "NOT_FOUND" | "INVITATION_EXPIRED" | "INVITATION_EMAIL_MISMATCH";

/**
 * What the link of an Invitation shows to whoever opens it, signed in or not:
 * the Company, the role and the invited address. Refuses an unknown token
 * (`NOT_FOUND`) and an Invitation no longer open (`INVITATION_EXPIRED`), unless
 * the signed-in user is already a Member: they go to the Company without an error.
 */
export async function invitationByToken(
  c: Context<SkeletonEnv>,
  token: string,
  userId: string | null,
): Promise<{ invitation: InvitationByToken } | { refused: Exclude<AcceptRefusal, "INVITATION_EMAIL_MISMATCH"> }> {
  const found = await findByToken(c.var.db, token);
  if (!found) return { refused: "NOT_FOUND" };
  const alreadyMember = userId !== null && (await roleIn(c.var.db, found.companyId, userId)) !== null;
  if (!isOpen(found) && !alreadyMember) return { refused: "INVITATION_EXPIRED" };
  const { companyId, companyName, email, role, expiresAt } = found;
  return { invitation: { companyId, companyName, email, role, expiresAt: expiresAt.toISOString(), alreadyMember } };
}

/**
 * The signed-in user accepts the Invitation of the link: they become a Member
 * with its role, the Invitation is marked accepted (it leaves the pending list),
 * and every feature's `memberJoined` runs. Only the invited address may accept
 * (`INVITATION_EMAIL_MISMATCH`). A user who is already a Member gets the Company,
 * and nothing changes.
 */
export async function acceptInvitation(
  c: Context<SkeletonEnv>,
  token: string,
): Promise<{ company: JoinedCompany } | { refused: AcceptRefusal }> {
  const { db } = c.var;
  const user = c.var.identity.user;
  const found = await findByToken(db, token);
  if (!found) return { refused: "NOT_FOUND" };
  const company = (role: string) => ({ company: { id: found.companyId, name: found.companyName, createdAt: found.companyCreatedAt, role } });

  const current = await roleIn(db, found.companyId, user.id);
  if (current !== null) return company(current);
  if (!isOpen(found)) return { refused: "INVITATION_EXPIRED" };
  if (user.email.toLowerCase() !== found.email) return { refused: "INVITATION_EMAIL_MISMATCH" };

  const joined = await db.transaction(async (tx) => {
    const [accepted] = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitations.id, found.id), pending, gt(invitations.expiresAt, new Date())))
      .returning({ id: invitations.id });
    if (!accepted) return false;
    await tx.insert(members).values({ companyId: found.companyId, userId: user.id, role: found.role });
    return true;
  });
  if (!joined) {
    // Another request accepted it first: the same user clicking twice is a Member by now.
    const role = await roleIn(db, found.companyId, user.id);
    return role === null ? { refused: "INVITATION_EXPIRED" } : company(role);
  }
  await emitMemberJoined(c.var.features, { db, companyId: found.companyId, userId: user.id });
  return company(found.role);
}

async function findByToken(db: Database, token: string) {
  const [found] = await db
    .select({
      id: invitations.id,
      companyId: invitations.companyId,
      companyName: companies.name,
      companyCreatedAt: companies.createdAt,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      canceledAt: invitations.canceledAt,
    })
    .from(invitations)
    .innerJoin(companies, eq(companies.id, invitations.companyId))
    .where(eq(invitations.tokenHash, await hashToken(token)));
  return found ?? null;
}

/** Neither accepted, canceled nor expired: the link still lets the invited address in. */
function isOpen(invitation: { acceptedAt: Date | null; canceledAt: Date | null; expiresAt: Date }) {
  return !invitation.acceptedAt && !invitation.canceledAt && invitation.expiresAt.getTime() > Date.now();
}

/** The user's role in the Company, or `null` when they are not a Member. */
async function roleIn(db: Database, companyId: string, userId: string): Promise<string | null> {
  const [member] = await db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.companyId, companyId), eq(members.userId, userId)));
  return member?.role ?? null;
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
