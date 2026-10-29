import { HttpResponse } from "msw";
import { getLastCompanyHandler, getLastCompanyHandlerResponse404 } from "../../src/gen/msw/getLastCompanyHandler.ts";
import { getMeHandler } from "../../src/gen/msw/getMeHandler.ts";
import { getNavHandler } from "../../src/gen/msw/getNavHandler.ts";
import { updateMeHandler, updateMeHandlerResponse400 } from "../../src/gen/msw/updateMeHandler.ts";
import { format, messagesFor } from "../../src/i18n/index.ts";
import { authError, changeEmailHandler, changePasswordHandler, deleteUserHandler } from "../spa/auth-handlers.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

const ana = { id: "user-1", name: "Ana Souza", email: "ana@example.com", pendingEmail: null as string | null };

/** The test composition's navigation: the Skeleton's account entry, then a Product feature's (`notes`), and its Company page section. */
const nav = (t = messagesFor("en")) => ({
  entries: [
    { label: t.account.nav, to: "/account" },
    { label: "Notes", to: "/notes" },
  ],
  companyPage: [{ label: "Notes", to: "/notes" }],
  accountPage: [],
});

/** A user in no Company: the signed-in root stays home. */
const noCompany = getLastCompanyHandler(() => getLastCompanyHandlerResponse404({ code: "NOT_FOUND", message: "Not found." }));

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
  worker.use(getMeHandler(ana), getNavHandler(nav()), noCompany);

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
  worker.use(...api.handlers, getNavHandler(nav()), noCompany);
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
  // A refetch of getMe can show the pending change before the request is recorded.
  await expect.poll(() => change.requests).toEqual([{ newEmail: "ana.lima@example.com", callbackURL: "/email-verified" }]);
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

test("changing the password on the account page sends the current and the new one and says the other sessions ended", async ({ worker }) => {
  const change = changePasswordHandler();
  worker.use(getMeHandler(ana), getNavHandler(nav()), change.handler);
  const { screen, router, t } = await renderSpa({ path: "/account" });

  const current = screen.getByLabelText(t.account.password.current);
  const next = screen.getByLabelText(t.account.password.new);
  await current.fill("correct horse battery");
  await next.fill("a brand new passphrase");
  await screen.getByRole("button", { name: t.account.password.submit }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent(t.account.password.changed);
  await expect.element(current).toHaveValue("");
  await expect.element(next).toHaveValue("");
  expect(change.requests).toEqual([{ currentPassword: "correct horse battery", newPassword: "a brand new passphrase" }]);
  expect(router.state.location.pathname).toBe("/account");
  await expect.element(screen.getByTestId("user-name")).toHaveTextContent(ana.name);
});

test("a wrong current password and a new one outside the rules show the message translated by its code", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  worker.use(getMeHandler(ana), getNavHandler(nav(t)));
  const { screen } = await renderSpa({ path: "/account", locale: "pt-BR" });

  for (const [code, message] of [
    ["INVALID_PASSWORD", "Invalid password"],
    ["PASSWORD_TOO_SHORT", "Password too short"],
  ] as const) {
    worker.use(changePasswordHandler(authError(400, code, message)).handler);
    await screen.getByLabelText(t.account.password.current).fill("correct horse battery");
    await screen.getByLabelText(t.account.password.new).fill("short");
    await screen.getByRole("button", { name: t.account.password.submit }).click();

    await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors[code]);
    await expect.element(screen.getByRole("alert")).not.toHaveTextContent(message);
    await expect.element(screen.getByLabelText(t.account.password.current)).toHaveValue("correct horse battery");
  }
});

test("deleting the account asks for the password in a confirmation form, then goes to the sign-in screen", async ({ worker }) => {
  const deletion = deleteUserHandler();
  worker.use(getMeHandler(ana), getNavHandler(nav()), deletion.handler);
  const { screen, router, t } = await renderSpa({ path: "/account" });
  const m = t.account.delete;

  await expect.element(screen.getByRole("heading", { name: m.title })).toBeVisible();
  await expect.element(screen.getByLabelText(m.password)).not.toBeInTheDocument();
  await screen.getByRole("button", { name: m.start }).click();
  await screen.getByRole("button", { name: m.cancel }).click();
  await expect.element(screen.getByLabelText(m.password)).not.toBeInTheDocument();
  await screen.getByRole("button", { name: m.start }).click();
  await screen.getByLabelText(m.password).fill("correct horse battery");
  await screen.getByRole("button", { name: m.submit }).click();

  await expect.element(screen.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  await expect.element(screen.getByRole("status")).toHaveTextContent(t.auth.signIn.accountDeleted);
  expect(router.state.location.pathname).toBe("/sign-in");
  expect(deletion.requests).toEqual([{ password: "correct horse battery" }]);
});

test("an Owner is refused with the Companies to transfer or delete first, linked to their pages", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  const companies = [
    { id: "company-1", name: "Acme" },
    { id: "company-2", name: "Globex" },
  ];
  worker.use(
    getMeHandler(ana),
    getNavHandler(nav(t)),
    deleteUserHandler({ status: 409, body: { code: "OWNER_OF_COMPANIES", message: "You are the Owner.", companies } }).handler,
  );
  const { screen, router } = await renderSpa({ path: "/account", locale: "pt-BR" });
  const m = t.account.delete;

  await screen.getByRole("button", { name: m.start }).click();
  await screen.getByLabelText(m.password).fill("correct horse battery");
  await screen.getByRole("button", { name: m.submit }).click();

  const alert = screen.getByRole("alert");
  await expect.element(alert.getByText(t.errors.OWNER_OF_COMPANIES)).toBeVisible();
  await expect.element(alert).not.toHaveTextContent("You are the Owner.");
  for (const company of companies) {
    await expect.element(alert.getByRole("link", { name: company.name })).toHaveAttribute("href", `/c/${company.id}`);
  }
  expect(router.state.location.pathname).toBe("/account");
  await expect.element(screen.getByTestId("user-name")).toHaveTextContent(ana.name);
});

test("a Member is refused with the Companies whose Owners must remove them", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  const companies = [{ id: "company-1", name: "Acme" }];
  worker.use(
    getMeHandler(ana),
    getNavHandler(nav(t)),
    deleteUserHandler({ status: 409, body: { code: "MEMBER_OF_COMPANIES", message: "You work there.", companies } }).handler,
  );
  const { screen, router } = await renderSpa({ path: "/account", locale: "pt-BR" });
  const m = t.account.delete;

  await screen.getByRole("button", { name: m.start }).click();
  await screen.getByLabelText(m.password).fill("correct horse battery");
  await screen.getByRole("button", { name: m.submit }).click();

  const alert = screen.getByRole("alert");
  await expect.element(alert.getByText(t.errors.MEMBER_OF_COMPANIES)).toBeVisible();
  await expect.element(alert.getByText(m.companiesToLeave)).toBeVisible();
  await expect.element(alert.getByRole("link", { name: "Acme" })).toHaveAttribute("href", "/c/company-1");
  expect(router.state.location.pathname).toBe("/account");
});

test("an active plan is refused with the day it stays valid once canceled, not refunded, and a link to the plan", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  worker.use(
    getMeHandler(ana),
    getNavHandler(nav(t)),
    deleteUserHandler({ status: 409, body: { code: "SUBSCRIPTION_ACTIVE", message: "Cancel first.", periodEnd: "2026-11-28T12:00:00.000Z" } }).handler,
  );
  const { screen, router } = await renderSpa({ path: "/account", locale: "pt-BR" });
  const m = t.account.delete;

  await screen.getByRole("button", { name: m.start }).click();
  await screen.getByLabelText(m.password).fill("correct horse battery");
  await screen.getByRole("button", { name: m.submit }).click();

  const alert = screen.getByRole("alert");
  await expect.element(alert.getByText(t.errors.SUBSCRIPTION_ACTIVE)).toBeVisible();
  await expect.element(alert.getByText(/2026/)).toBeVisible();
  await expect.element(alert.getByText(/não são reembolsados/)).toBeVisible();
  await expect.element(alert.getByRole("link", { name: m.planLink })).toHaveAttribute("href", "/account/plan");
  expect(router.state.location.pathname).toBe("/account");
});

test("a wrong password is refused with the message translated by its code, and the user stays", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  worker.use(getMeHandler(ana), getNavHandler(nav(t)), deleteUserHandler(authError(400, "INVALID_PASSWORD", "Invalid password")).handler);
  const { screen, router } = await renderSpa({ path: "/account", locale: "pt-BR" });
  const m = t.account.delete;

  await screen.getByRole("button", { name: m.start }).click();
  await screen.getByLabelText(m.password).fill("not my password");
  await screen.getByRole("button", { name: m.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.INVALID_PASSWORD);
  await expect.element(screen.getByRole("alert")).not.toHaveTextContent("Invalid password");
  expect(router.state.location.pathname).toBe("/account");
});
