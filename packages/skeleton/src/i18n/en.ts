import type { KnownErrorCode } from "../platform/error-codes.ts";

/**
 * The Skeleton's English texts: the source of truth for the message shape.
 * Every other locale is typed `Messages`, so a missing or extra key fails `tsc`.
 * `{name}` placeholders are filled by `format()`.
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
  auth: {
    signUp: {
      title: "Create your account",
      description: "Sign up with your email and a password.",
      name: "Name",
      email: "Email",
      password: "Password",
      passwordHint: "At least 8 characters.",
      submit: "Create account",
      submitting: "Creating your account…",
    },
    checkEmail: {
      title: "Check your email",
      description: "We sent a verification link to {email}. Open it to start using {appName}.",
      resend: "Send the link again",
      resending: "Sending…",
      resent: "We sent a new link. It may take a minute to arrive.",
    },
    emailVerified: {
      title: "Email verified",
      description: "Your email is verified. You can now sign in.",
      failedTitle: "We could not verify your email",
    },
  },
  emails: {
    verifyEmail: {
      subject: "Verify your email",
      preview: "Confirm your email to start using {appName}.",
      heading: "Verify your email",
      greeting: "Hi {name},",
      body: "Confirm that {email} is your email address to start using {appName}.",
      button: "Verify email",
      fallback: "If the button does not work, open this link:",
      ignore: "If you did not create an account, you can ignore this email.",
    },
  },
  errors: {
    NOT_FOUND: "We could not find what you asked for.",
    VALIDATION_FAILED: "Some of the information is not valid.",
    INTERNAL_ERROR: "Something went wrong on our side. Please try again.",
    DATABASE_UNAVAILABLE: "The service is temporarily unavailable. Please try again soon.",
    INVALID_EMAIL: "Enter a valid email address.",
    PASSWORD_TOO_SHORT: "The password is too short.",
    PASSWORD_TOO_LONG: "The password is too long.",
    USER_ALREADY_EXISTS: "An account with this email already exists.",
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email already exists. Use another email.",
    EMAIL_NOT_VERIFIED: "Verify your email before you continue.",
    INVALID_TOKEN: "This link is not valid. Ask for a new one.",
    TOKEN_EXPIRED: "This link has expired. Ask for a new one.",
    USER_NOT_FOUND: "We could not find this account.",
    unexpected: "Something went wrong. Check your connection and try again.",
  } satisfies Record<KnownErrorCode | "unexpected", string>,
};

export type Messages = typeof en;
