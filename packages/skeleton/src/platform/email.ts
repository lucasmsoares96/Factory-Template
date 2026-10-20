import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Resend } from "resend";
import { emailOutbox } from "../db/schema.ts";

/** A rendered email, ready for a transport. */
export type Email = { to: string; subject: string; html: string; text: string };

export type SendEmail = (email: Email) => Promise<void>;

/**
 * Where emails go: `resend` (production; the default) or `outbox`, a table read
 * in previews and tests. Set by the `EMAIL_TRANSPORT` var.
 */
export type EmailTransport = "resend" | "outbox";

export function emailTransport(value: string | undefined): EmailTransport {
  return value === "outbox" ? "outbox" : "resend";
}

/** The Worker's email adapter: every email leaves from the Product's `from`. */
export function createEmailSender({
  transport,
  from,
  resendApiKey,
  db,
}: {
  transport: EmailTransport;
  from: string;
  resendApiKey: string | undefined;
  db: NodePgDatabase;
}): SendEmail {
  if (transport === "outbox") {
    return async (email) => {
      await db.insert(emailOutbox).values({ ...email, from });
    };
  }
  return async (email) => {
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY is not set. Set the secret, or EMAIL_TRANSPORT=outbox outside production.");
    }
    const { error } = await new Resend(resendApiKey).emails.send({ from, ...email });
    if (error) throw new Error(`Resend refused the email (${error.name}): ${error.message}`);
  };
}
