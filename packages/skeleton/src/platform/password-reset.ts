import type { Context } from "hono";
import type { SkeletonEnv } from "./env.ts";

/** Takes away one kind of access the user granted before the reset. */
type AccessRevoker = (c: Context<SkeletonEnv>, user: { id: string }) => Promise<void>;

/**
 * Access a password reset takes away besides the user's sessions. Better Auth
 * deletes the sessions itself, in the same transaction as the new password
 * (`revokeSessionsOnPasswordReset`). The user's MCP Connections join in ticket 06
 * (`listUserGrants` + `revokeGrant`), here and nowhere else.
 */
const revokers: AccessRevoker[] = [];

/**
 * The single place that revokes what outlives a password reset. Better Auth
 * calls it (`onPasswordReset`) after the new password is saved and the sessions
 * are gone, before the response. A failure here fails the request although the
 * password changed; asking for a new link and resetting again runs it again.
 */
export async function revokeAccessAfterPasswordReset(c: Context<SkeletonEnv>, user: { id: string }): Promise<void> {
  for (const revoke of revokers) await revoke(c, user);
}
