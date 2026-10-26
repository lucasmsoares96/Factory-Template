import type { Messages } from "../i18n/index.ts";
import type { Email } from "../platform/email.ts";
import { linkEmail } from "./link-email.tsx";

/**
 * The email an Invitation sends to its address: the Company, who invited and
 * the role, with the link that leads to accepting it.
 */
export function invitationEmail({
  t,
  to,
  companyName,
  inviterName,
  role,
  url,
}: {
  t: Messages;
  to: string;
  companyName: string;
  inviterName: string;
  /** The role as the email shows it (translated when it is one of the Skeleton's). */
  role: string;
  url: string;
}): Promise<Email> {
  return linkEmail({
    to,
    texts: t.emails.invitation,
    values: { appName: t.app.title, companyName, inviterName, role },
    url,
  });
}
