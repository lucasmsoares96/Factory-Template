import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createTestHarness } from "wrangler";
import { builtWorkerConfig } from "../src/node/built-worker.ts";
import { migrateDatabase } from "../src/node/migrate.ts";
import { ensurePostgres } from "../src/node/postgres.ts";
import { mockResend } from "../src/node/resend-mock.ts";
import { BASE_URL_ENV, MAILBOX_DIR_ENV, PRODUCT_DIR_ENV } from "./index.ts";

/**
 * Starts the Product's built Worker on a migrated database, with Resend
 * intercepted in this process (MSW): each email the Worker sends lands as a JSON
 * file in the mailbox folder, where the specs read it. The teardown stops it all.
 */
export default async function setup() {
  const dir = process.env[PRODUCT_DIR_ENV];
  if (!dir) throw new Error(`${PRODUCT_DIR_ENV} is not set: use defineE2EConfig.`);

  const mailbox = join(dir, "test-results/mailbox");
  rmSync(mailbox, { recursive: true, force: true });
  mkdirSync(mailbox, { recursive: true });
  process.env[MAILBOX_DIR_ENV] = mailbox;
  const resend = mockResend((email) => {
    writeFileSync(join(mailbox, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(email));
  });

  const postgres = ensurePostgres({ purpose: `e2e-${basename(dir)}`, cwd: dir });
  try {
    await migrateDatabase({ databaseUrl: postgres.url, productMigrationsFolder: join(dir, "drizzle") });
    const server = createTestHarness({
      workers: [
        {
          configPath: builtWorkerConfig(dir),
          secrets: {
            DATABASE_URL: postgres.url,
            BETTER_AUTH_SECRET: `e2e-${randomUUID()}`,
            RESEND_API_KEY: "re_e2e_intercepted",
          },
        },
      ],
    });
    const { url } = await server.listen();
    process.env[BASE_URL_ENV] = url.href;
    return async () => {
      await server.close();
      resend.close();
      postgres.stop();
    };
  } catch (error) {
    resend.close();
    postgres.stop();
    throw error;
  }
}
