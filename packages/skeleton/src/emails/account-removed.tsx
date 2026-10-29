import type { Messages } from "../i18n/index.ts";
import type { Email } from "../platform/email.ts";
import { noticeEmail } from "./link-email.tsx";

/**
 * The email a person gets when the Owner removes them from their last Company and
 * their account, created by an Invitation, is deleted with it.
 */
export function accountRemovedEmail({
  t,
  user,
  companyName,
}: {
  t: Messages;
  user: { name: string; email: string };
  companyName: string;
}): Promise<Email> {
  return noticeEmail({
    to: user.email,
    texts: t.emails.accountRemoved,
    values: { appName: t.app.title, name: user.name, companyName },
  });
}
