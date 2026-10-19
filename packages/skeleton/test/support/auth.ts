import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { messagesFor } from "../../src/i18n/index.ts";
import { authOptions } from "../../src/platform/auth-options.ts";
import { TEST_SECRET } from "./worker.ts";

/**
 * A test-only Better Auth instance over the test database, built from the same
 * config as the Worker's plus `testUtils()`: it creates users and sessions
 * directly, so a test can skip the flows it is not about. It never sends email.
 */
export async function createTestAuth({ databaseUrl, baseURL }: { databaseUrl: string; baseURL: string }) {
  const db = drizzle({ connection: { connectionString: databaseUrl, max: 1 } });
  const auth = betterAuth({
    ...authOptions({
      db,
      secret: TEST_SECRET,
      baseURL,
      t: messagesFor("en"),
      sendEmail: async () => {
        throw new Error("The test-only auth instance sends no email.");
      },
    }),
    plugins: [testUtils()],
  });
  const { test } = await auth.$context;
  return { ...test, close: () => db.$client.end() };
}
