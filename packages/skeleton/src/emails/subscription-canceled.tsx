import { format, type Messages } from "../i18n/index.ts";
import type { Email } from "../platform/email.ts";
import { linkEmail } from "./link-email.tsx";

/**
 * The email an Owner gets when their Subscription is set to end with the period: the last day and, when there are any,
 * how many people lose access to their Companies then.
 */
export function subscriptionCanceledEmail({
  t,
  to,
  name,
  planName,
  endsOn,
  losingAccess,
  url,
}: {
  t: Messages;
  to: string;
  name: string;
  planName: string;
  /** The last day of the paid period, already formatted for the app's language. */
  endsOn: string;
  /** The people who lose access to the Owner's Companies when the period ends. */
  losingAccess: number;
  /** The Plan page. */
  url: string;
}): Promise<Email> {
  const { bodyPeopleOne, bodyPeopleOther, ...texts } = t.emails.subscriptionCanceled;
  const values = { appName: t.app.title, name, planName, endsOn };
  const people = losingAccess > 0 ? ` ${format(losingAccess === 1 ? bodyPeopleOne : bodyPeopleOther, { count: String(losingAccess) })}` : "";
  return linkEmail({ to, texts: { ...texts, body: `${texts.body}${people}` }, values, url });
}
