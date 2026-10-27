import type { Context } from "hono";
import type { SkeletonEnv } from "./env.ts";
import { revokeConnections } from "./mcp/connections.ts";

/** Takes away one kind of access the user granted. */
type AccessRevoker = (c: Context<SkeletonEnv>, user: { id: string }) => Promise<void>;

/**
 * Access that a credential change (a password reset or a password change) or
 * the account's deletion takes away besides the user's sessions. Better Auth
 * deletes the sessions itself: in the same transaction as the new password
 * (`revokeSessionsOnPasswordReset`, and `revokeOtherSessions`, which the
 * Skeleton forces on a change), or with the user. The user's MCP Connections
 * (grants and their tokens, `listUserGrants` + `revokeGrant`) go here, and
 * every later kind of access too.
 */
const revokers: AccessRevoker[] = [revokeConnections];

/**
 * The single place that revokes what outlives a credential change or the
 * account. Better Auth calls it after the new password is saved and the
 * sessions are gone, before the response (`onPasswordReset` for a reset, an
 * after hook for a change); a failure fails the request although the password
 * changed, and resetting or changing it again runs it again. For a deletion it
 * runs just before the user is deleted, so a failure keeps the account and the
 * user can try again.
 */
export async function revokeAccess(c: Context<SkeletonEnv>, user: { id: string }): Promise<void> {
  for (const revoke of revokers) await revoke(c, user);
}
