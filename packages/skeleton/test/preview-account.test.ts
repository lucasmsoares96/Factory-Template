import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// `previews.ts account` is the step of the PR workflow's `deploy` job that puts the Default account in the preview branch.
const exec = promisify(execFile);
const script = join(import.meta.dirname, "../../../.factory/src/ci/previews.ts");

let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url });
});
afterAll(async () => {
  await worker?.close();
  await db?.drop();
});

async function account(env: Record<string, string>) {
  const urlFile = join(await mkdtemp(join(tmpdir(), "preview-account-")), "direct-url");
  await writeFile(urlFile, `${db.url}\n`);
  return exec(process.execPath, [script, "account", "--url-file", urlFile], { env: { ...process.env, ...env } });
}

test("creates the verified account, is idempotent, keeps only the hash, and the Worker signs in with the previews' password", async () => {
  const env = { ACCOUNT_EMAIL: "Owner@Example.com", ACCOUNT_PASSWORD: "preview password 1" };

  await account(env);
  await account(env);

  expect(await db.query(`SELECT email_verified FROM skeleton.users WHERE email = 'owner@example.com'`)).toEqual([{ email_verified: true }]);
  const hashes = await db.query<{ password: string }>(`SELECT password FROM skeleton.accounts WHERE provider_id = 'credential'`);
  expect(hashes).toHaveLength(1);
  expect(hashes[0]!.password).not.toContain("preview password 1");
  const signIn = (password: string) => worker.post("/api/auth/sign-in/email", { email: "owner@example.com", password });
  expect((await signIn("preview password 1")).status).toBe(200);
  expect((await signIn("production password 1")).status).toBe(401);
});

test("does nothing when the email or the password is missing", async () => {
  const before = await db.query(`SELECT 1 FROM skeleton.users`);

  const { stdout } = await account({ ACCOUNT_EMAIL: "", ACCOUNT_PASSWORD: "" });

  expect(stdout).toContain("no Default account");
  expect(await db.query(`SELECT 1 FROM skeleton.users`)).toEqual(before);
});
