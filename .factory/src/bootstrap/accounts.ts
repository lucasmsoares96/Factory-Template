import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { AccountsClient } from "./clients.ts";
import { productSecretName } from "./domain.ts";

/** The CI smoke signs in as this user. `<ID>_SMOKE_PASSWORD` is a secret, `<ID>_SMOKE_EMAIL` a variable. */
export function smokeNames(productId: string) {
  return { password: productSecretName(productId, "SMOKE_PASSWORD"), email: productSecretName(productId, "SMOKE_EMAIL") };
}

/**
 * `smoke@<domain>`; when the Product has no domain, `smoke@<id>.invalid` (`.invalid` is reserved, so it can never be a real mailbox
 * and a sign-in needs no email delivery).
 */
export function smokeEmail(productId: string, domain: string): string {
  const host = domain.trim().toLowerCase();
  return `smoke@${host || `${productId}.invalid`}`;
}

/** 24 random bytes in base64url: far above the Skeleton's 8-character minimum and under its 128 maximum. */
export function generatePassword(): string {
  return randomBytes(24).toString("base64url");
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
  async hasVerifiedUserOtherThan(databaseUrl: string, email: string): Promise<boolean> {
    return (await import("../../../packages/skeleton/src/node/accounts.ts")).hasVerifiedUserOtherThan({ databaseUrl, email });
  }
  async upsertUser(databaseUrl: string, user: { email: string; name: string; password: string }) {
    return (await import("../../../packages/skeleton/src/node/accounts.ts")).upsertVerifiedUser({ databaseUrl, ...user });
  }
}
