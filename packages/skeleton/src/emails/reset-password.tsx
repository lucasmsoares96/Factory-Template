import type { Messages } from "../i18n/index.ts";
import type { Email } from "../platform/email.ts";
import { linkEmail } from "./link-email.tsx";

/**
 * The email Better Auth asks for when someone requests a password reset for a
 * registered address. Its link goes through `/api/auth/reset-password/<token>`,
 * which checks the token and lands on the SPA's new-password screen.
 */
export function resetPasswordEmail({
  t,
  user,
  url,
}: {
  t: Messages;
  user: { name: string; email: string };
  url: string;
}): Promise<Email> {
  return linkEmail({
    to: user.email,
    texts: t.emails.resetPassword,
    values: { appName: t.app.title, name: user.name, email: user.email },
    url,
  });
}
