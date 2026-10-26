/**
 * Every error the API answers with: a stable `code` plus an English `message`
 * for logs and API clients. The SPA never shows `message`; it translates `code`
 * (the i18n `errors` table has one entry per code, enforced by the compiler).
 * No imports: the SPA bundles this file.
 */
export const errorMessages = {
  NOT_FOUND: "Not found.",
  VALIDATION_FAILED: "The request is invalid.",
  INTERNAL_ERROR: "Something went wrong.",
  DATABASE_UNAVAILABLE: "The database is unavailable.",
  UNAUTHENTICATED: "Sign in to continue.",
  TOO_MANY_REQUESTS: "Too many requests. Try again later.",
  FORBIDDEN: "Your role in this Company does not allow this.",
  ALREADY_A_MEMBER: "This email already belongs to a Member of the Company.",
  INVITATION_PENDING: "This email already has a pending Invitation to the Company. Resend it instead.",
  INVITATION_EMAIL_MISMATCH: "This Invitation is for another email address. Sign in with that address to accept it.",
  INVITATION_EXPIRED: "This Invitation expired or was canceled. Ask for a new one.",
} as const;

export type ErrorCode = keyof typeof errorMessages;

/**
 * The codes Better Auth answers `/api/auth/*` with (same `{ code, message }`
 * shape) that the auth screens can show. Better Auth owns their messages; the
 * SPA translates them like any other code.
 */
export const authErrorCodes = [
  "INVALID_EMAIL",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_TOO_LONG",
  "USER_ALREADY_EXISTS",
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_PASSWORD",
  "EMAIL_NOT_VERIFIED",
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "USER_NOT_FOUND",
] as const;

export type AuthErrorCode = (typeof authErrorCodes)[number];

/** Every code the SPA can translate. */
export type KnownErrorCode = ErrorCode | AuthErrorCode;

export function isKnownErrorCode(code: unknown): code is KnownErrorCode {
  return (
    typeof code === "string" &&
    (Object.hasOwn(errorMessages, code) || (authErrorCodes as readonly string[]).includes(code))
  );
}
