import type { Messages } from "../i18n/index.ts";
import type { Email } from "../platform/email.ts";
import { linkEmail } from "./link-email.tsx";

/** The email an Owner gets when Stripe could not charge the card: it says until when the card can be updated. */
export function paymentFailedEmail({
  t,
  to,
  name,
  planName,
  deadline,
  url,
}: {
  t: Messages;
  to: string;
  name: string;
  planName: string;
  /** The last day to update the card, already formatted for the app's language. */
  deadline: string;
  /** The Plan page, where the card is updated. */
  url: string;
}): Promise<Email> {
  return linkEmail({ to, texts: t.emails.paymentFailed, values: { appName: t.app.title, name, planName, deadline }, url });
}
