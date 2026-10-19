import { createAuthClient } from "better-auth/react";
import { AUTH_BASE_PATH } from "../platform/auth-base-path.ts";

/** Better Auth's client for the SPA: same origin, `/api/auth`. */
export const authClient = createAuthClient({ basePath: AUTH_BASE_PATH });

/** Where the verification link lands once Better Auth has checked it. */
export const EMAIL_VERIFIED_PATH = "/email-verified";

/** Where the password-reset link lands once Better Auth has checked its token (`?token=` or `?error=`). */
export const RESET_PASSWORD_PATH = "/reset-password";

/** Better Auth answers `{ data, error }`; screens want a thrown error they can translate by `code`. */
export async function orThrow<T>(result: Promise<{ data: T; error: null } | { data: null; error: object }>) {
  const { data, error } = await result;
  if (error) throw error;
  return data as T;
}

/** Where a visitor without a session is sent. */
export const SIGN_IN_PATH = "/sign-in";

/**
 * The path to return to after signing in, if it is one of this SPA's own
 * (a relative path, never `//host` or `/\host`), else the home page.
 */
export function safeRedirect(path: string | undefined): string {
  return path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}
