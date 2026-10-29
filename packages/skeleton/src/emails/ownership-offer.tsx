import type { Messages } from "../i18n/index.ts";
import type { Email } from "../platform/email.ts";
import { linkEmail } from "./link-email.tsx";

/**
 * The email an ownership offer sends to the Member it is offered to: the Company
 * and who offers it, with the link to the Company page, where they accept.
 */
export function ownershipOfferEmail({
  t,
  to,
  companyName,
  ownerName,
  url,
}: {
  t: Messages;
  to: string;
  companyName: string;
  ownerName: string;
  url: string;
}): Promise<Email> {
  return linkEmail({ to, texts: t.emails.ownershipOffer, values: { appName: t.app.title, companyName, ownerName }, url });
}
