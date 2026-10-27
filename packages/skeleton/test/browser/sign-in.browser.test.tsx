import { getMeHandler, getMeHandlerResponse401 } from "../../src/gen/msw/getMeHandler.ts";
import { authError, signInHandler, tooManyRequests } from "../spa/auth-handlers.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

const email = "ana@example.com";
const name = "Ana Souza";
const signedOut = getMeHandler(() => getMeHandlerResponse401({ code: "UNAUTHENTICATED", message: "Sign in to continue." }));
const signedIn = getMeHandler({ id: "user-1", name, email, pendingEmail: null });

test("a visitor signs in and lands on the home page, greeted by name", async ({ worker }) => {
  const signIn = signInHandler();
  worker.use(signIn.handler, signedOut);
  const { screen, t } = await renderSpa({ path: "/sign-in" });

  await screen.getByLabelText(t.auth.signIn.email).fill(email);
  await screen.getByLabelText(t.auth.signIn.password).fill("correct horse battery");
  worker.use(signedIn);
  await screen.getByRole("button", { name: t.auth.signIn.submit }).click();

  await expect.element(screen.getByTestId("user-name")).toHaveTextContent(name);
  expect(signIn.requests).toEqual([{ email, password: "correct horse battery" }]);
});

test("a wrong password shows the reason translated by its code and keeps the email", async ({ worker }) => {
  worker.use(signInHandler(authError(401, "INVALID_EMAIL_OR_PASSWORD", "Invalid email or password")).handler);
  const { screen, t } = await renderSpa({ path: "/sign-in", locale: "pt-BR" });

  await screen.getByLabelText(t.auth.signIn.email).fill(email);
  await screen.getByLabelText(t.auth.signIn.password).fill("wrong password");
  await screen.getByRole("button", { name: t.auth.signIn.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.INVALID_EMAIL_OR_PASSWORD);
  await expect.element(screen.getByRole("alert")).not.toHaveTextContent("Invalid email or password");
  await expect.element(screen.getByLabelText(t.auth.signIn.email)).toHaveValue(email);
});

test("too many attempts show the rate-limit message", async ({ worker }) => {
  worker.use(signInHandler(tooManyRequests).handler);
  const { screen, t } = await renderSpa({ path: "/sign-in" });

  await screen.getByLabelText(t.auth.signIn.email).fill(email);
  await screen.getByLabelText(t.auth.signIn.password).fill("correct horse battery");
  await screen.getByRole("button", { name: t.auth.signIn.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.TOO_MANY_REQUESTS);
});

test("an unverified email is told to verify and offered a new link", async ({ worker }) => {
  worker.use(signInHandler(authError(403, "EMAIL_NOT_VERIFIED", "Email not verified")).handler);
  const { screen, router, t } = await renderSpa({ path: "/sign-in" });

  await screen.getByLabelText(t.auth.signIn.email).fill(email);
  await screen.getByLabelText(t.auth.signIn.password).fill("correct horse battery");
  await screen.getByRole("button", { name: t.auth.signIn.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.EMAIL_NOT_VERIFIED);
  await screen.getByRole("link", { name: t.auth.signIn.verifyEmail }).click();
  await expect.element(screen.getByRole("heading", { name: t.auth.checkEmail.title })).toBeVisible();
  expect(router.state.location.search).toEqual({ email });
});

test("the sign-in screen links to the sign-up screen, and back", async () => {
  const { screen, t } = await renderSpa({ path: "/sign-in" });

  await screen.getByRole("link", { name: t.auth.signIn.signUp }).click();
  await expect.element(screen.getByRole("heading", { name: t.auth.signUp.title })).toBeVisible();
  await screen.getByRole("link", { name: t.auth.signUp.signIn }).click();
  await expect.element(screen.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
});
