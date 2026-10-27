import type { Messages } from "../i18n/index.ts";
import type { Email } from "../platform/email.ts";
import { linkEmail } from "./link-email.tsx";

/**
 * The email Better Auth asks for when a signed-in user asks to change their
 * email: it goes to the new address, and the account's email changes only when
 * its link (`/api/auth/verify-email`) is opened.
 */
export function changeEmailEmail({
  t,
  user,
  newEmail,
  url,
}: {
  t: Messages;
  user: { name: string };
  newEmail: string;
  url: string;
}): Promise<Email> {
  return linkEmail({
    to: newEmail,
    texts: t.emails.changeEmail,
    values: { appName: t.app.title, name: user.name, email: newEmail },
    url,
  });
}
