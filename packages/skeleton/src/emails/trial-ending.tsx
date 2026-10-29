import type { Messages } from "../i18n/index.ts";
import type { Email } from "../platform/email.ts";
import { linkEmail } from "./link-email.tsx";

/** The email an Owner gets three days before a free trial ends and Stripe first charges the card. */
export function trialEndingEmail({
  t,
  to,
  name,
  planName,
  endsOn,
  url,
}: {
  t: Messages;
  to: string;
  name: string;
  planName: string;
  /** The trial's end, already formatted for the app's language. */
  endsOn: string;
  /** The Plan page, where the Subscription can be canceled. */
  url: string;
}): Promise<Email> {
  return linkEmail({ to, texts: t.emails.trialEnding, values: { appName: t.app.title, name, planName, endsOn }, url });
}
