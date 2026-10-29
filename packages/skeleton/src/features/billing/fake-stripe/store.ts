import { sql } from "drizzle-orm";
import type { Database } from "../../../platform/db.ts";

/**
 * Where the fake Stripe keeps what Stripe would: a table that exists only when
 * the fake runs (`pnpm dev`, tests). It is created on first use, not by a
 * migration, so no production database ever has it.
 */
const TABLE = sql.raw("skeleton.fake_stripe");

/** The databases whose table is already created, so a request pays for it once. */
const ready = new Set<string>();

export type StoredObject = { id: string; [field: string]: unknown };

/** A key-value store of Stripe objects (`kind` says which API object an `id` is), newest listed first. */
export class FakeStripeStore {
  private readonly db: Database;
  private readonly databaseUrl: string;

  constructor(db: Database, databaseUrl: string) {
    this.db = db;
    this.databaseUrl = databaseUrl;
  }

  async ensure() {
    if (ready.has(this.databaseUrl)) return;
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id text PRIMARY KEY,
        kind text NOT NULL,
        body jsonb NOT NULL,
        seq bigserial
      )`);
    ready.add(this.databaseUrl);
  }

  async put<T extends StoredObject>(kind: string, body: T): Promise<T> {
    await this.ensure();
    await this.db.execute(sql`
      INSERT INTO ${TABLE} (id, kind, body) VALUES (${body.id}, ${kind}, ${JSON.stringify(body)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body`);
    return body;
  }

  async get<T extends StoredObject>(kind: string, id: string): Promise<T | undefined> {
    await this.ensure();
    const { rows } = await this.db.execute<{ body: T }>(
      sql`SELECT body FROM ${TABLE} WHERE kind = ${kind} AND id = ${id}`,
    );
    return rows[0]?.body;
  }

  async list<T extends StoredObject>(kind: string): Promise<T[]> {
    await this.ensure();
    const { rows } = await this.db.execute<{ body: T }>(
      sql`SELECT body FROM ${TABLE} WHERE kind = ${kind} ORDER BY seq DESC`,
    );
    return rows.map((row) => row.body);
  }

  async remove(kind: string, id: string) {
    await this.ensure();
    await this.db.execute(sql`DELETE FROM ${TABLE} WHERE kind = ${kind} AND id = ${id}`);
  }

  /** Forgets everything, settings included. */
  async clear() {
    await this.ensure();
    await this.db.execute(sql`DELETE FROM ${TABLE}`);
  }
}
