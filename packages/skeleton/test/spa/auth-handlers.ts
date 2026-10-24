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
      const text = await request.text();
      requests.push(text ? (JSON.parse(text) as Body) : {});
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

/** `POST /api/auth/sign-in/email`: the session cookie is Better Auth's business, the SPA reads `/api/me`. */
export function signInHandler(answer?: Answer) {
  return handler("/sign-in/email", answer ?? ok({ redirect: false, token: "session-token", user: { ...user("ana@example.com"), emailVerified: true } }));
}

/** `POST /api/auth/sign-out`. */
export function signOutHandler(answer: Answer = ok({ success: true })) {
  return handler("/sign-out", answer);
}

/** `POST /api/auth/request-password-reset`: the same answer whether the email is registered or not. */
export function requestPasswordResetHandler(answer?: Answer) {
  return handler(
    "/request-password-reset",
    answer ?? ok({ status: true, message: "If this email exists in our system, check your email for the reset link" }),
  );
}

/** `POST /api/auth/reset-password`: the token the emailed link brought and the new password. */
export function resetPasswordHandler(answer: Answer = ok({ status: true })) {
  return handler("/reset-password", answer);
}

/** Better Auth's 429, as the Worker answers it (`TOO_MANY_REQUESTS`). */
export const tooManyRequests = authError(429, "TOO_MANY_REQUESTS", "Too many requests. Try again later.");

/** `POST /api/auth/change-email`: the verification email goes to the new address; the email stays until it is opened. */
export function changeEmailHandler(answer: Answer = ok({ status: true })) {
  return handler("/change-email", answer);
}
