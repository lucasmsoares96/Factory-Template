import { http, HttpResponse } from "msw";

// Better Auth's routes stay out of the OpenAPI document, so Kubb generates no
// handlers for them. These answer like Better Auth does, and record the request body.

type Body = Record<string, unknown>;
type Answer = { status: number; body: Body };

const ok = (body: Body): Answer => ({ status: 200, body });

/** A Better Auth error: `{ code, message }` with its HTTP status. */
export const authError = (status: number, code: string, message = code): Answer => ({ status, body: { code, message } });

function handler(path: string, answer: Answer) {
  const requests: Body[] = [];
  return {
    requests,
    handler: http.post(`/api/auth${path}`, async ({ request }) => {
      requests.push((await request.json()) as Body);
      return HttpResponse.json(answer.body, { status: answer.status });
    }),
  };
}

const user = (email: string) => ({
  id: "user-1",
  name: "Ana Souza",
  email,
  emailVerified: false,
  image: null,
  createdAt: "2026-10-19T12:00:00.000Z",
  updatedAt: "2026-10-19T12:00:00.000Z",
});

/** `POST /api/auth/sign-up/email`: with required verification, no session (`token: null`). */
export function signUpHandler(answer?: Answer) {
  return handler("/sign-up/email", answer ?? ok({ token: null, user: user("ana@example.com") }));
}

/** `POST /api/auth/send-verification-email`. */
export function sendVerificationEmailHandler(answer: Answer = ok({ status: true })) {
  return handler("/send-verification-email", answer);
}
