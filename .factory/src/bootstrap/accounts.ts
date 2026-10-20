import { resolve } from "node:path";
import type { AccountsClient } from "./clients.ts";
import { productSecretName } from "./domain.ts";

/**
 * The Product's one account, the human's and the production smoke's. `<ID>_ACCOUNT_PASSWORD` is a deploy secret (the user's
 * choice: the smoke has to sign in), `<ID>_ACCOUNT_EMAIL` a variable.
 */
export function accountNames(productId: string) {
  return { password: productSecretName(productId, "ACCOUNT_PASSWORD"), email: productSecretName(productId, "ACCOUNT_EMAIL") };
}

/** The real database client: the Skeleton's Node entry points, loaded when first used (they pull in drizzle and `pg`). */
export class SkeletonAccounts implements AccountsClient {
  async migrate(databaseUrl: string, productId: string): Promise<void> {
    const { migrateDatabase } = await import("../../../packages/skeleton/src/node/migrate.ts");
    await migrateDatabase({ databaseUrl, productMigrationsFolder: resolve(import.meta.dirname, "../../../apps", productId, "drizzle") });
  }
  async userExists(databaseUrl: string, email: string): Promise<boolean> {
    return (await import("../../../packages/skeleton/src/node/accounts.ts")).userExists({ databaseUrl, email });
  }
  async verifiedUserExists(databaseUrl: string, email: string): Promise<boolean> {
    return (await import("../../../packages/skeleton/src/node/accounts.ts")).verifiedUserExists({ databaseUrl, email });
  }
  async upsertUser(databaseUrl: string, user: { email: string; name: string; password: string }) {
    return (await import("../../../packages/skeleton/src/node/accounts.ts")).upsertVerifiedUser({ databaseUrl, ...user });
  }
}
