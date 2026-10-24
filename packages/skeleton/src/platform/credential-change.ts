import type { Context } from "hono";
import type { SkeletonEnv } from "./env.ts";
import { revokeConnections } from "./mcp/connections.ts";

/** Takes away one kind of access the user granted before the credential changed. */
type AccessRevoker = (c: Context<SkeletonEnv>, user: { id: string }) => Promise<void>;

/**
 * Access a credential change (a password reset or a password change) takes away
 * besides the user's sessions. Better Auth deletes the sessions itself, in the
 * same transaction as the new password (`revokeSessionsOnPasswordReset`, and
 * `revokeOtherSessions`, which the Skeleton forces on a change). The user's MCP
 * Connections (grants and their tokens, `listUserGrants` + `revokeGrant`) go
 * here, and every later kind of access too.
 */
const revokers: AccessRevoker[] = [revokeConnections];

/**
 * The single place that revokes what outlives a credential change. Better Auth
 * calls it after the new password is saved and the sessions are gone, before
 * the response: `onPasswordReset` for a reset, an after hook for a change. A
 * failure here fails the request although the password changed; resetting or
 * changing it again runs it again.
 */
export async function revokeAccessAfterCredentialChange(c: Context<SkeletonEnv>, user: { id: string }): Promise<void> {
  for (const revoke of revokers) await revoke(c, user);
}
