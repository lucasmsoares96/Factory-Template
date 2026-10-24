import { HttpResponse } from "msw";
import { authError, changeEmailHandler } from "../spa/auth-handlers.ts";
import { getMeHandler } from "../../src/gen/msw/getMeHandler.ts";
import { getNavHandler } from "../../src/gen/msw/getNavHandler.ts";
import { updateMeHandler, updateMeHandlerResponse400 } from "../../src/gen/msw/updateMeHandler.ts";
import { format, messagesFor } from "../../src/i18n/index.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

const ana = { id: "user-1", name: "Ana Souza", email: "ana@example.com", pendingEmail: null as string | null };

/** The test composition's navigation: the Skeleton's account entry, then a Product feature's (`notes`). */
const nav = (t = messagesFor("en")) => ({
  entries: [
    { label: t.account.nav, to: "/account" },
    { label: "Notes", to: "/notes" },
  ],
});

/** `GET` and `PATCH /api/me` over one user, as the Worker does: a rename shows in the next read. */
function meApi() {
  const user = { ...ana };
  const renames: unknown[] = [];
  return {
    renames,
    handlers: [
      getMeHandler(() => HttpResponse.json(user)),
      updateMeHandler(async ({ request }) => {
        const body = await request.json();
        renames.push(body);
        user.name = body.name.trim();
        return HttpResponse.json(user);
      }),
    ],
  };
}

test("the signed-in navigation shows home, the account page and every feature's nav entry", async ({ worker }) => {
  worker.use(getMeHandler(ana), getNavHandler(nav()));

  const { screen, router, t } = await renderSpa();

  const navigation = screen.getByRole("navigation", { name: t.nav.label });
  await expect.element(navigation.getByRole("link", { name: t.nav.home })).toHaveAttribute("href", "/");
  await expect.element(navigation.getByRole("link", { name: nav().entries[1]!.label })).toHaveAttribute("href", "/notes");
  await navigation.getByRole("link", { name: t.account.nav }).click();
  await expect.element(screen.getByRole("heading", { name: t.account.title })).toBeVisible();
  expect(router.state.location.pathname).toBe("/account");
});

test("saving a new name on the account page updates the name on top and the home page's title", async ({ worker }) => {
  const api = meApi();
  worker.use(...api.handlers, getNavHandler(nav()));
  const { screen, router, t } = await renderSpa({ path: "/account" });

  const name = screen.getByLabelText(t.account.name);
  await expect.element(name).toHaveValue(ana.name);
  await name.fill("  Ana Lima  ");
  await screen.getByRole("button", { name: t.account.submit }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent(t.account.saved);
  await expect.element(screen.getByTestId("user-name")).toHaveTextContent("Ana Lima");
  await expect.element(name).toHaveValue("Ana Lima");
  expect(api.renames).toEqual([{ name: "  Ana Lima  " }]);
  expect(router.state.location.pathname).toBe("/account");
  await screen.getByRole("navigation", { name: t.nav.label }).getByRole("link", { name: t.nav.home }).click();
  await expect.element(screen.getByRole("heading", { name: format(t.home.title, { name: "Ana Lima" }) })).toBeVisible();
});

test("an invalid name is refused with the message translated by its code, and the name on top stays", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  worker.use(
    getMeHandler(ana),
    getNavHandler(nav(t)),
    updateMeHandler(() => updateMeHandlerResponse400({ code: "VALIDATION_FAILED", message: "The request is invalid." })),
  );
  const { screen } = await renderSpa({ path: "/account", locale: "pt-BR" });

  await screen.getByLabelText(t.account.name).fill("   ");
  await screen.getByRole("button", { name: t.account.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.VALIDATION_FAILED);
  await expect.element(screen.getByRole("alert")).not.toHaveTextContent("The request is invalid.");
  await expect.element(screen.getByTestId("user-name")).toHaveTextContent(ana.name);
});

test("asking to change the email shows the change as pending, for the new address, and keeps the current email", async ({ worker }) => {
  const user = { ...ana };
  const change = changeEmailHandler();
  worker.use(getMeHandler(() => HttpResponse.json(user)), getNavHandler(nav()), change.handler);
  const { screen, t } = await renderSpa({ path: "/account" });
  await expect.element(screen.getByTestId("current-email")).toHaveTextContent(format(t.account.currentEmail, { email: ana.email }));
  // The Worker records the pending change before it answers.
  worker.use(getMeHandler(() => HttpResponse.json({ ...user, pendingEmail: "ana.lima@example.com" })));

  await screen.getByLabelText(t.account.newEmail).fill("ana.lima@example.com");
  await screen.getByRole("button", { name: t.account.changeEmail }).click();

  await expect
    .element(screen.getByTestId("email-pending"))
    .toHaveTextContent(format(t.account.emailPending, { email: "ana.lima@example.com", current: ana.email }));
  await expect.element(screen.getByTestId("current-email")).toHaveTextContent(format(t.account.currentEmail, { email: ana.email }));
  expect(change.requests).toEqual([{ newEmail: "ana.lima@example.com", callbackURL: "/email-verified" }]);
});

test("a change of email asked earlier shows as pending when the account page opens", async ({ worker }) => {
  worker.use(getMeHandler({ ...ana, pendingEmail: "ana.lima@example.com" }), getNavHandler(nav()));

  const { screen, t } = await renderSpa({ path: "/account" });

  await expect
    .element(screen.getByTestId("email-pending"))
    .toHaveTextContent(format(t.account.emailPending, { email: "ana.lima@example.com", current: ana.email }));
});

test("an email that belongs to another account is refused with the message translated by its code", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  const message = "User already exists. Use another email.";
  const change = changeEmailHandler(authError(400, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", message));
  worker.use(getMeHandler(ana), getNavHandler(nav(t)), change.handler);
  const { screen } = await renderSpa({ path: "/account", locale: "pt-BR" });

  await screen.getByLabelText(t.account.newEmail).fill("bruno@example.com");
  await screen.getByRole("button", { name: t.account.changeEmail }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL);
  await expect.element(screen.getByRole("alert")).not.toHaveTextContent(message);
  await expect.element(screen.getByTestId("email-pending")).not.toBeInTheDocument();
});
