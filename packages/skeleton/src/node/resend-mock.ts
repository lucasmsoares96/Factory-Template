import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

/** An email the Worker handed to Resend's API. */
export type SentEmail = { from: string; to: string[]; subject: string; html: string; text: string };

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";

/**
 * Intercepts Resend's API in this Node process, which is where `createTestHarness()`
 * sends the Worker's outbound `fetch`. Every email goes to `onEmail` and gets a
 * fake id back; nothing leaves the machine. Any other request off localhost fails.
 */
export function mockResend(onEmail: (email: SentEmail) => void) {
  const server = setupServer(
    http.post(RESEND_EMAILS_URL, async ({ request }) => {
      const body = (await request.json()) as {
        from: string;
        to: string | string[];
        subject: string;
        html: string;
        text?: string;
      };
      onEmail({ from: body.from, to: [body.to].flat(), subject: body.subject, html: body.html, text: body.text ?? "" });
      return HttpResponse.json({ id: crypto.randomUUID() });
    }),
  );
  server.listen({
    onUnhandledFrame({ frame, defaults }) {
      const request = (frame.data as { request?: Request }).request;
      const host = request ? new URL(request.url).hostname : "";
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return;
      defaults.error();
    },
  });
  return server;
}
