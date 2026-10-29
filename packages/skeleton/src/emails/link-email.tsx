import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Text, render } from "react-email";
import type { CSSProperties, ReactElement } from "react";
import { format } from "../i18n/index.ts";
import type { Email } from "../platform/email.ts";

const styles = {
  body: { backgroundColor: "#f4f4f5", fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: "24px 0" },
  container: { backgroundColor: "#ffffff", borderRadius: "8px", margin: "0 auto", maxWidth: "480px", padding: "32px" },
  heading: { color: "#18181b", fontSize: "22px", margin: "0 0 16px" },
  text: { color: "#3f3f46", fontSize: "15px", lineHeight: "24px" },
  button: {
    backgroundColor: "#18181b",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "15px",
    padding: "12px 20px",
    textDecoration: "none",
  },
  small: { color: "#71717a", fontSize: "13px", lineHeight: "20px", wordBreak: "break-all" },
} satisfies Record<string, CSSProperties>;

/** Renders an email to the `html` and `text` every transport sends. */
export async function renderEmail(to: string, subject: string, element: ReactElement): Promise<Email> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { to, subject, html, text };
}

/** The i18n texts of an email whose point is one link (`{name}` placeholders allowed). */
export type LinkEmailTexts = {
  subject: string;
  preview: string;
  heading: string;
  greeting: string;
  body: string;
  button: string;
  fallback: string;
  ignore: string;
};

/**
 * An email that asks the user to open one link (verify the email, reset the
 * password): heading, greeting, body, a button, the raw link as a fallback and
 * a line for whoever did not ask for it.
 */
export function linkEmail({
  to,
  texts,
  values,
  url,
}: {
  to: string;
  texts: LinkEmailTexts;
  values: Record<string, string>;
  url: string;
}): Promise<Email> {
  return renderEmail(
    to,
    format(texts.subject, values),
    <Html>
      <Head />
      <Preview>{format(texts.preview, values)}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{format(texts.heading, values)}</Heading>
          <Text style={styles.text}>{format(texts.greeting, values)}</Text>
          <Text style={styles.text}>{format(texts.body, values)}</Text>
          <Button href={url} style={styles.button}>
            {texts.button}
          </Button>
          <Text style={styles.small}>
            {texts.fallback} <Link href={url}>{url}</Link>
          </Text>
          <Hr />
          <Text style={styles.small}>{format(texts.ignore, values)}</Text>
        </Container>
      </Body>
    </Html>,
  );
}

/** The i18n texts of an email that only informs (no link). */
export type NoticeEmailTexts = Omit<LinkEmailTexts, "button" | "fallback">;

/** An email that tells the user something happened: heading, greeting, body and a closing line. */
export function noticeEmail({
  to,
  texts,
  values,
}: {
  to: string;
  texts: NoticeEmailTexts;
  values: Record<string, string>;
}): Promise<Email> {
  return renderEmail(
    to,
    format(texts.subject, values),
    <Html>
      <Head />
      <Preview>{format(texts.preview, values)}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{format(texts.heading, values)}</Heading>
          <Text style={styles.text}>{format(texts.greeting, values)}</Text>
          <Text style={styles.text}>{format(texts.body, values)}</Text>
          <Hr />
          <Text style={styles.small}>{format(texts.ignore, values)}</Text>
        </Container>
      </Body>
    </Html>,
  );
}
