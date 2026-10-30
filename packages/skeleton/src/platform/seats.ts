import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { companies, invitations, members, users } from "../db/schema.ts";
import type { Database, Transaction } from "./db.ts";

/** One person in the Companies an Owner owns, as a Seat holds them. */
export type SeatPerson = {
  companyId: string;
  companyName: string;
  /** The user's name; `null` for an address that was only invited. */
  name: string | null;
  email: string;
  status: "owner" | "member" | "invited";
  /** Whether the Member is suspended (a Seat they still hold). Never the Owner or an invited address. */
  suspended: boolean;
};

/**
 * Every person in the Companies `ownerId` owns: the Owner, each Member and each
 * pending Invitation, Company by Company (oldest Company first; in a Company the
 * Owner, the Members by when they joined, then the Invitations). The same person
 * appears in each Company they are in; a Seat counts them once (`countSeats`).
 */
export async function seatPeople(db: Database | Transaction, ownerId: string): Promise<SeatPerson[]> {
  const owned = await db
    .select({ id: companies.id, name: companies.name })
    .from(members)
    .innerJoin(companies, eq(companies.id, members.companyId))
    .where(and(eq(members.userId, ownerId), eq(members.role, "owner")))
    .orderBy(asc(companies.createdAt), asc(companies.id));
  const people: SeatPerson[] = [];
  for (const company of owned) {
    const inCompany = await db
      .select({ name: users.name, email: users.email, role: members.role, suspendedAt: members.suspendedAt })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.companyId, company.id))
      .orderBy(sql`${members.role} = 'owner' desc`, asc(members.createdAt), asc(users.id));
    const invited = await db
      .select({ email: invitations.email })
      .from(invitations)
      .where(and(eq(invitations.companyId, company.id), isNull(invitations.acceptedAt), isNull(invitations.canceledAt)))
      .orderBy(asc(invitations.createdAt), asc(invitations.id));
    for (const person of inCompany) {
      people.push({ companyId: company.id, companyName: company.name, name: person.name, email: person.email, status: person.role === "owner" ? "owner" : "member", suspended: person.role !== "owner" && person.suspendedAt !== null });
    }
    for (const { email } of invited) people.push({ companyId: company.id, companyName: company.name, name: null, email, status: "invited", suspended: false });
  }
  return people;
}

/** The Seats `people` take: one for each distinct address, however many Companies they are in. */
export function countSeats(people: readonly Pick<SeatPerson, "email">[]): number {
  return new Set(people.map((person) => person.email.toLowerCase())).size;
}

/**
 * How many people would lose access if the Owner's Seats fell to `limit`, the way `applySeatLimit` decides: pending
 * Invitations go first, so only what is still over the limit after them suspends people. Nobody already suspended and
 * never the Owner counts. A `null` limit loses nobody.
 */
export function countLosingAccess(people: readonly SeatPerson[], limit: number | null): number {
  if (limit === null) return 0;
  const byEmail = new Map<string, SeatPerson["status"]>();
  const suspended = new Set<string>();
  for (const person of people) {
    const email = person.email.toLowerCase();
    if (person.suspended) suspended.add(email);
    const known = byEmail.get(email);
    if (known === "owner" || (known === "member" && person.status === "invited")) continue;
    byEmail.set(email, person.status);
  }
  const statuses = [...byEmail.entries()];
  const invitedOnly = statuses.filter(([, status]) => status === "invited").length;
  const active = statuses.filter(([email, status]) => status !== "invited" && !suspended.has(email));
  const over = Math.max(0, active.length + invitedOnly - limit);
  const canceled = Math.min(over, invitedOnly);
  const losing = over - canceled;
  return Math.min(losing, active.filter(([, status]) => status === "member").length);
}

/** Whether `email` already holds a Seat among `people`. */
export function holdsSeat(people: readonly Pick<SeatPerson, "email">[], email: string): boolean {
  const wanted = email.toLowerCase();
  return people.some((person) => person.email.toLowerCase() === wanted);
}

/** The user who owns the Company, or `null` when it has none. */
export async function ownerOf(db: Database | Transaction, companyId: string): Promise<string | null> {
  const [owner] = await db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.companyId, companyId), eq(members.role, "owner")));
  return owner?.userId ?? null;
}

/**
 * Serializes the changes that take Seats from `ownerId` until the transaction
 * ends, so two of them cannot both pass the check on the last free Seat.
 */
export async function lockSeats(tx: Transaction, ownerId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`seats:${ownerId}`}))`);
}

/** What `applySeatLimit` changed. */
export type SeatReconciliation = {
  /** The pending Invitations it canceled, newest first. */
  canceledInvitations: number;
  /** The people it suspended, newest first, as user ids. */
  suspended: string[];
  /** The people it brought back, longest suspended first, as user ids. */
  restored: string[];
};

/**
 * Makes the Companies `ownerId` owns fit `limit` Seats, nobody removed. When the Seats fall short the pending
 * Invitations go first (newest first, only as many as needed), then the people who joined last are suspended in every
 * Company of the Owner (a Suspended Member keeps their place; the Owner never is). When a Seat is free, the person
 * suspended the longest comes back. Suspended Members still count in `seatPeople`, so no Invitation takes the Seat of
 * someone waiting to come back. `limit` is `null` or `undefined` for no limit: everyone comes back.
 * Hold `lockSeats` for the transaction.
 */
export async function applySeatLimit(
  tx: Transaction,
  ownerId: string,
  limit: number | null | undefined,
): Promise<SeatReconciliation> {
  const result: SeatReconciliation = { canceledInvitations: 0, suspended: [], restored: [] };
  const owned = await tx
    .select({ id: companies.id })
    .from(members)
    .innerJoin(companies, eq(companies.id, members.companyId))
    .where(and(eq(members.userId, ownerId), eq(members.role, "owner")));
  if (owned.length === 0) return result;
  const companyIds = owned.map((company) => company.id);

  const rows = await tx
    .select({ userId: members.userId, email: users.email, joinedAt: members.createdAt, suspendedAt: members.suspendedAt })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(inArray(members.companyId, companyIds));
  const invites = await tx
    .select({ id: invitations.id, email: invitations.email, createdAt: invitations.createdAt })
    .from(invitations)
    .where(and(inArray(invitations.companyId, companyIds), isNull(invitations.acceptedAt), isNull(invitations.canceledAt)))
    .orderBy(sql`${invitations.createdAt} desc`, sql`${invitations.id} desc`);

  type Person = { userId: string; email: string; joinedAt: number; suspendedAt: number | null };
  const byUser = new Map<string, Person>();
  for (const row of rows) {
    const known = byUser.get(row.userId);
    const joinedAt = row.joinedAt.getTime();
    const suspendedAt = row.userId === ownerId ? null : (row.suspendedAt?.getTime() ?? null);
    byUser.set(row.userId, {
      userId: row.userId,
      email: row.email.toLowerCase(),
      joinedAt: known ? Math.min(known.joinedAt, joinedAt) : joinedAt,
      suspendedAt: known?.suspendedAt != null && suspendedAt != null ? Math.min(known.suspendedAt, suspendedAt) : (known?.suspendedAt ?? suspendedAt),
    });
  }
  const people = [...byUser.values()];
  const personEmails = new Set(people.map((person) => person.email));
  const cap = limit ?? Number.POSITIVE_INFINITY;

  // A Seat for each person who has access, and for each address only invited.
  const invitedOnly = new Set(invites.filter((invite) => !personEmails.has(invite.email)).map((invite) => invite.email));
  const active = people.filter((person) => person.suspendedAt === null);
  let used = active.length + invitedOnly.size;

  if (used > cap) {
    const canceled: string[] = [];
    for (const invite of invites) {
      if (used <= cap) break;
      if (!invitedOnly.has(invite.email)) continue;
      // Every pending Invitation of that address goes, from every Company: together they held one Seat.
      for (const same of invites.filter((candidate) => candidate.email === invite.email)) canceled.push(same.id);
      invitedOnly.delete(invite.email);
      used -= 1;
    }
    if (canceled.length > 0) {
      await tx.update(invitations).set({ canceledAt: new Date() }).where(inArray(invitations.id, canceled));
      result.canceledInvitations = canceled.length;
    }
    const newestFirst = active
      .filter((person) => person.userId !== ownerId)
      .sort((a, b) => b.joinedAt - a.joinedAt || (a.userId < b.userId ? 1 : -1));
    for (const person of newestFirst) {
      if (used <= cap) break;
      result.suspended.push(person.userId);
      used -= 1;
    }
    if (result.suspended.length > 0) {
      await tx
        .update(members)
        .set({ suspendedAt: new Date() })
        .where(and(inArray(members.companyId, companyIds), inArray(members.userId, result.suspended)));
    }
  } else {
    const waiting = people
      .filter((person) => person.suspendedAt !== null)
      .sort((a, b) => a.suspendedAt! - b.suspendedAt! || a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1));
    for (const person of waiting) {
      if (used >= cap) break;
      result.restored.push(person.userId);
      used += 1;
    }
  }
  if (result.restored.length > 0) {
    await tx.update(members).set({ suspendedAt: null }).where(and(inArray(members.companyId, companyIds), inArray(members.userId, result.restored)));
  }
  // A person invited to another Company of the Owner while suspended: all their rows are suspended alike.
  for (const person of people) {
    if (person.suspendedAt === null || result.restored.includes(person.userId)) continue;
    await tx
      .update(members)
      .set({ suspendedAt: new Date(person.suspendedAt) })
      .where(and(inArray(members.companyId, companyIds), eq(members.userId, person.userId), isNull(members.suspendedAt)));
  }
  return result;
}
