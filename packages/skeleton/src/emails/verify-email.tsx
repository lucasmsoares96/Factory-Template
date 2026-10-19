import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Text, render } from "react-email";
import type { CSSProperties, ReactElement } from "react";
import { format, type Messages } from "../i18n/index.ts";
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

/** The verification email Better Auth asks for on sign-up and on resend. */
export function verificationEmail({
  t,
  user,
  url,
}: {
  t: Messages;
  user: { name: string; email: string };
  url: string;
}): Promise<Email> {
  const texts = t.emails.verifyEmail;
  const values = { appName: t.app.title, name: user.name, email: user.email };
  return renderEmail(
    user.email,
    texts.subject,
    <Html>
      <Head />
      <Preview>{format(texts.preview, values)}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>{texts.heading}</Heading>
          <Text style={styles.text}>{format(texts.greeting, values)}</Text>
          <Text style={styles.text}>{format(texts.body, values)}</Text>
          <Button href={url} style={styles.button}>
            {texts.button}
          </Button>
          <Text style={styles.small}>
            {texts.fallback} <Link href={url}>{url}</Link>
          </Text>
          <Hr />
          <Text style={styles.small}>{texts.ignore}</Text>
        </Container>
      </Body>
    </Html>,
  );
}
