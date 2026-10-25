import { HttpResponse } from "msw";
import { getLastCompanyHandler, getLastCompanyHandlerResponse404 } from "../../src/gen/msw/getLastCompanyHandler.ts";
import { getMeHandler, getMeHandlerResponse401 } from "../../src/gen/msw/getMeHandler.ts";
import { format } from "../../src/i18n/index.ts";
import { signOutHandler } from "../spa/auth-handlers.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

const ana = { id: "user-1", name: "Ana Souza", email: "ana@example.com", pendingEmail: null };
/** A user in no Company: the signed-in root stays home. */
const noCompany = getLastCompanyHandler(() => getLastCompanyHandlerResponse404({ code: "NOT_FOUND", message: "Not found." }));
const signedOut = getMeHandler(() => getMeHandlerResponse401({ code: "UNAUTHENTICATED", message: "Sign in to continue." }));

test("the home page greets the signed-in user by the name GET /api/me answers", async ({ worker }) => {
  worker.use(getMeHandler(ana), noCompany);

  const { screen, t } = await renderSpa();

  await expect.element(screen.getByRole("heading", { name: format(t.home.title, { name: ana.name }) })).toBeVisible();
  await expect.element(screen.getByTestId("user-name")).toHaveTextContent(ana.name);
});

test("without a session the home page sends the visitor to sign in", async ({ worker }) => {
  worker.use(signedOut);

  const { screen, router, t } = await renderSpa();

  await expect.element(screen.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  expect(router.state.location.pathname).toBe("/sign-in");
});

test("signing out ends the session and lands on the sign-in screen", async ({ worker }) => {
  const signOut = signOutHandler();
  worker.use(getMeHandler(ana), noCompany, signOut.handler);
  const { screen, router, t } = await renderSpa();

  await screen.getByRole("button", { name: t.auth.signOut }).click();

  await expect.element(screen.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  await expect.element(screen.getByRole("status")).toHaveTextContent(t.auth.signIn.signedOut);
  expect(router.state.location.pathname).toBe("/sign-in");
  expect(signOut.requests).toHaveLength(1);
});

test("an API failure is shown translated by its code, never by the English message", async ({ worker }) => {
  worker.use(
    getMeHandler(() => HttpResponse.json({ code: "INTERNAL_ERROR", message: "Something went wrong." }, { status: 500 })),
  );

  const { screen, t } = await renderSpa({ locale: "pt-BR" });

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.INTERNAL_ERROR);
  await expect.element(screen.getByRole("alert")).not.toHaveTextContent("Something went wrong.");
});
