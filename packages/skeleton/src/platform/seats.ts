import { and, asc, eq, isNull, sql } from "drizzle-orm";
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
      .select({ name: users.name, email: users.email, role: members.role })
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
      people.push({ companyId: company.id, companyName: company.name, name: person.name, email: person.email, status: person.role === "owner" ? "owner" : "member" });
    }
    for (const { email } of invited) people.push({ companyId: company.id, companyName: company.name, name: null, email, status: "invited" });
  }
  return people;
}

/** The Seats `people` take: one for each distinct address, however many Companies they are in. */
export function countSeats(people: readonly Pick<SeatPerson, "email">[]): number {
  return new Set(people.map((person) => person.email.toLowerCase())).size;
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
