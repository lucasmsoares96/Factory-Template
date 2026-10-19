import type { Messages } from "../i18n/index.ts";
import type { Email } from "../platform/email.ts";
import { linkEmail } from "./link-email.tsx";

/** The verification email Better Auth asks for on sign-up and on resend. */
export function verificationEmail({
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
    texts: t.emails.verifyEmail,
    values: { appName: t.app.title, name: user.name, email: user.email },
    url,
  });
}
