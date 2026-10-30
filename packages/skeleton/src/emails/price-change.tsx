import type { Messages } from "../i18n/index.ts";
import type { Email } from "../platform/email.ts";
import { linkEmail } from "./link-email.tsx";

/** The email an Owner gets when a Plan's price is scheduled to change at the Subscription's next renewal. */
export function priceChangeEmail({
  t,
  to,
  name,
  planName,
  oldPrice,
  newPrice,
  startsOn,
  url,
}: {
  t: Messages;
  to: string;
  name: string;
  planName: string;
  /** The prices, already formatted for the app's language and the Plan's currency. */
  oldPrice: string;
  newPrice: string;
  /** The renewal where the new price starts, already formatted for the app's language. */
  startsOn: string;
  /** The Plan page, where the Subscription can be canceled. */
  url: string;
}): Promise<Email> {
  return linkEmail({ to, texts: t.emails.priceChange, values: { appName: t.app.title, name, planName, oldPrice, newPrice, startsOn }, url });
}
