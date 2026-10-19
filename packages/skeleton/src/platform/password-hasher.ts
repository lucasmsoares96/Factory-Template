import { hashPassword, verifyPassword } from "better-auth/crypto";
import { DurableObject } from "cloudflare:workers";

/**
 * A stateless Durable Object that runs Better Auth's scrypt (default parameters,
 * so stored hashes stay valid) outside the Worker's CPU budget. Every Product
 * Worker exports it and binds it as `PASSWORD_HASHER`; the Worker reaches it
 * through `passwordHashing()`.
 */
export class PasswordHasher extends DurableObject {
  hash(password: string): Promise<string> {
    return hashPassword(password);
  }

  verify(hash: string, password: string): Promise<boolean> {
    return verifyPassword({ hash, password });
  }
}
