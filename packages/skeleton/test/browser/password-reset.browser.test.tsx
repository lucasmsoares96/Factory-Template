import { format } from "../../src/i18n/index.ts";
import { authError, requestPasswordResetHandler, resetPasswordHandler, tooManyRequests } from "../spa/auth-handlers.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

const email = "ana@example.com";

test("the sign-in screen leads a visitor who forgot their password to ask for a reset", async () => {
  const { screen, t } = await renderSpa({ path: "/sign-in" });

  await screen.getByRole("link", { name: t.auth.signIn.forgotPassword }).click();

  await expect.element(screen.getByRole("heading", { name: t.auth.forgotPassword.title })).toBeVisible();
});

test("asking for a reset says a link is on its way, whether or not the email has an account", async ({ worker }) => {
  const request = requestPasswordResetHandler();
  worker.use(request.handler);
  const { screen, t } = await renderSpa({ path: "/forgot-password", locale: "pt-BR" });

  await screen.getByLabelText(t.auth.forgotPassword.email).fill(email);
  await screen.getByRole("button", { name: t.auth.forgotPassword.submit }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent(format(t.auth.forgotPassword.sent, { email }));
  expect(request.requests).toEqual([{ email, redirectTo: "/reset-password" }]);
});

test("too many reset requests show the rate-limit message", async ({ worker }) => {
  worker.use(requestPasswordResetHandler(tooManyRequests).handler);
  const { screen, t } = await renderSpa({ path: "/forgot-password" });

  await screen.getByLabelText(t.auth.forgotPassword.email).fill(email);
  await screen.getByRole("button", { name: t.auth.forgotPassword.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.TOO_MANY_REQUESTS);
});

test("the emailed link opens the new-password screen, which sets it and sends the user to sign in", async ({ worker }) => {
  const reset = resetPasswordHandler();
  worker.use(reset.handler);
  const { screen, router, t } = await renderSpa({ path: "/reset-password?token=reset-token-1" });

  await screen.getByLabelText(t.auth.resetPassword.password).fill("a brand new passphrase");
  await screen.getByRole("button", { name: t.auth.resetPassword.submit }).click();

  await expect.element(screen.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  await expect.element(screen.getByRole("status")).toHaveTextContent(t.auth.signIn.passwordReset);
  expect(router.state.location.pathname).toBe("/sign-in");
  expect(reset.requests).toEqual([{ newPassword: "a brand new passphrase", token: "reset-token-1" }]);
});

test("a refused new password shows the reason translated by its code", async ({ worker }) => {
  worker.use(resetPasswordHandler(authError(400, "PASSWORD_TOO_SHORT", "Password too short")).handler);
  const { screen, t } = await renderSpa({ path: "/reset-password?token=reset-token-1", locale: "pt-BR" });

  await screen.getByLabelText(t.auth.resetPassword.password).fill("short");
  await screen.getByRole("button", { name: t.auth.resetPassword.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.PASSWORD_TOO_SHORT);
  await expect.element(screen.getByText("Password too short")).not.toBeInTheDocument();
});

test("a link already used offers to ask for a new one", async ({ worker }) => {
  worker.use(resetPasswordHandler(authError(400, "INVALID_TOKEN", "Invalid token")).handler);
  const { screen, t } = await renderSpa({ path: "/reset-password?token=used-token" });

  await screen.getByLabelText(t.auth.resetPassword.password).fill("a brand new passphrase");
  await screen.getByRole("button", { name: t.auth.resetPassword.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.INVALID_TOKEN);
  await screen.getByRole("link", { name: t.auth.resetPassword.requestNew }).click();
  await expect.element(screen.getByRole("heading", { name: t.auth.forgotPassword.title })).toBeVisible();
});

test("a link Better Auth refused lands on the reason, with a way to ask for a new one", async () => {
  const { screen, t } = await renderSpa({ path: "/reset-password?error=INVALID_TOKEN", locale: "pt-BR" });

  await expect.element(screen.getByRole("heading", { name: t.auth.resetPassword.failedTitle })).toBeVisible();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.INVALID_TOKEN);
  await expect.element(screen.getByLabelText(t.auth.resetPassword.password)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("link", { name: t.auth.resetPassword.requestNew })).toBeVisible();
});
