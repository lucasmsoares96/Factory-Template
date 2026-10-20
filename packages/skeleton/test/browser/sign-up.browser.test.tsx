import { format } from "../../src/i18n/index.ts";
import { authError, sendVerificationEmailHandler, signUpHandler } from "../spa/auth-handlers.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

const email = "ana@example.com";

test("a visitor signs up and is asked to open the link sent to their email", async ({ worker }) => {
  const signUp = signUpHandler();
  worker.use(signUp.handler);
  const { screen, t } = await renderSpa({ path: "/sign-up" });

  await screen.getByLabelText(t.auth.signUp.name).fill("Ana Souza");
  await screen.getByLabelText(t.auth.signUp.email).fill(email);
  await screen.getByLabelText(t.auth.signUp.password).fill("correct horse battery");
  await screen.getByRole("button", { name: t.auth.signUp.submit }).click();

  await expect.element(screen.getByRole("heading", { name: t.auth.checkEmail.title })).toBeVisible();
  await expect
    .element(screen.getByText(format(t.auth.checkEmail.description, { email, appName: t.app.title })))
    .toBeVisible();
  expect(signUp.requests).toEqual([
    { name: "Ana Souza", email, password: "correct horse battery", callbackURL: "/email-verified" },
  ]);
});

test("a refused sign-up shows the reason translated by its code and keeps the form", async ({ worker }) => {
  worker.use(signUpHandler(authError(400, "PASSWORD_TOO_SHORT", "Password too short")).handler);
  const { screen, t } = await renderSpa({ path: "/sign-up", locale: "pt-BR" });

  await screen.getByLabelText(t.auth.signUp.name).fill("Ana Souza");
  await screen.getByLabelText(t.auth.signUp.email).fill(email);
  await screen.getByLabelText(t.auth.signUp.password).fill("12345678");
  await screen.getByRole("button", { name: t.auth.signUp.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.PASSWORD_TOO_SHORT);
  await expect.element(screen.getByText("Password too short")).not.toBeInTheDocument();
  await expect.element(screen.getByLabelText(t.auth.signUp.email)).toHaveValue(email);
});

test("the check-your-email screen sends the link again on request", async ({ worker }) => {
  const resend = sendVerificationEmailHandler();
  worker.use(resend.handler);
  const { screen, t } = await renderSpa({ path: `/check-email?email=${encodeURIComponent(email)}` });

  await screen.getByRole("button", { name: t.auth.checkEmail.resend }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent(t.auth.checkEmail.resent);
  expect(resend.requests).toEqual([{ email, callbackURL: "/email-verified" }]);
});

test("the verification link lands on a confirmation", async () => {
  const { screen, t } = await renderSpa({ path: "/email-verified" });

  await expect.element(screen.getByRole("heading", { name: t.auth.emailVerified.title })).toBeVisible();
  await expect.element(screen.getByText(t.auth.emailVerified.description)).toBeVisible();
});

test("a link Better Auth refused lands on the reason, translated by its code", async () => {
  const { screen, t } = await renderSpa({ path: "/email-verified?error=TOKEN_EXPIRED", locale: "pt-BR" });

  await expect.element(screen.getByRole("heading", { name: t.auth.emailVerified.failedTitle })).toBeVisible();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.TOKEN_EXPIRED);
});
