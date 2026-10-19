import type { ErrorCode } from "../platform/error-codes.ts";

/**
 * The Skeleton's English texts: the source of truth for the message shape.
 * Every other locale is typed `Messages`, so a missing or extra key fails `tsc`.
 */
export const en = {
  app: {
    title: "Skeleton",
  },
  home: {
    title: "Welcome",
    apiStatusLabel: "API status",
    checking: "Checking…",
    apiStatus: { ok: "Up and running" },
  },
  errors: {
    NOT_FOUND: "We could not find what you asked for.",
    VALIDATION_FAILED: "Some of the information is not valid.",
    INTERNAL_ERROR: "Something went wrong on our side. Please try again.",
    DATABASE_UNAVAILABLE: "The service is temporarily unavailable. Please try again soon.",
    unexpected: "Something went wrong. Check your connection and try again.",
  } satisfies Record<ErrorCode | "unexpected", string>,
};

export type Messages = typeof en;
