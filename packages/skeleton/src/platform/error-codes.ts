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
} as const;

export type ErrorCode = keyof typeof errorMessages;

export function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && Object.hasOwn(errorMessages, code);
}
