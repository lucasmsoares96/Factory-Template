import { basename, join } from "node:path";
import { createTestHarness } from "wrangler";
import { migrateDatabase } from "../src/node/migrate.ts";
import { ensurePostgres } from "../src/node/postgres.ts";
import { BASE_URL_ENV, PRODUCT_DIR_ENV } from "./index.ts";

/** Starts the Product's built Worker on a migrated database; the teardown stops both. */
export default async function setup() {
  const dir = process.env[PRODUCT_DIR_ENV];
  if (!dir) throw new Error(`${PRODUCT_DIR_ENV} is not set: use defineE2EConfig.`);

  const postgres = ensurePostgres({ purpose: `e2e-${basename(dir)}`, cwd: dir });
  try {
    await migrateDatabase({ databaseUrl: postgres.url, productMigrationsFolder: join(dir, "drizzle") });
    const server = createTestHarness({
      workers: [
        {
          configPath: join(dir, "dist", basename(dir), "wrangler.json"),
          secrets: { DATABASE_URL: postgres.url },
        },
      ],
    });
    const { url } = await server.listen();
    process.env[BASE_URL_ENV] = url.href;
    return async () => {
      await server.close();
      postgres.stop();
    };
  } catch (error) {
    postgres.stop();
    throw error;
  }
}
