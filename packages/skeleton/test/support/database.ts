import { randomUUID } from "node:crypto";
import pg from "pg";

/** A fresh, empty database on the test server, dropped by `drop()`. */
export async function createEmptyDatabase() {
  const serverUrl = process.env.DATABASE_URL;
  if (!serverUrl) throw new Error("DATABASE_URL is not set (see test/support/global-setup.ts)");
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  await admin(serverUrl, `CREATE DATABASE "${name}"`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    async query<Row extends pg.QueryResultRow>(sql: string) {
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      try {
        return (await client.query<Row>(sql)).rows;
      } finally {
        await client.end();
      }
    },
    drop: () => admin(serverUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
  };
}

async function admin(serverUrl: string, sql: string) {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
