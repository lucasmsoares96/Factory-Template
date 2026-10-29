import { acceptInvitationHandler } from "../../src/gen/msw/acceptInvitationHandler.ts";
import { getCompanyHandler } from "../../src/gen/msw/getCompanyHandler.ts";
import { getInvitationByTokenHandler, getInvitationByTokenHandlerResponse410 } from "../../src/gen/msw/getInvitationByTokenHandler.ts";
import { getMeHandler, getMeHandlerResponse401 } from "../../src/gen/msw/getMeHandler.ts";
import { getNavHandler } from "../../src/gen/msw/getNavHandler.ts";
import { listCompaniesHandler } from "../../src/gen/msw/listCompaniesHandler.ts";
import { listMembersHandler } from "../../src/gen/msw/listMembersHandler.ts";
import { format, messagesFor } from "../../src/i18n/index.ts";
import { errorMessages } from "../../src/platform/error-codes.ts";
import { signOutHandler, signUpHandler } from "../spa/auth-handlers.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

// Seam 2: the Invitation link's screen over the generated MSW handlers.

const token = "invitation-token";
const path = `/invitations/${token}`;
const bruno = { id: "user-2", name: "Bruno Lima", email: "bruno@example.com", pendingEmail: null };
const acme = { id: "company-acme", name: "Acme", role: "employee", createdAt: "2026-10-24T12:00:00.000Z" };
const invitation = {
  companyId: acme.id,
  companyName: acme.name,
  email: bruno.email,
  role: "employee",
  expiresAt: "2026-10-31T12:00:00.000Z",
  alreadyMember: false,
};
const signedOut = getMeHandler(() => getMeHandlerResponse401({ code: "UNAUTHENTICATED", message: errorMessages.UNAUTHENTICATED }));

/** The Company page the accepted Invitation lands on. */
const companyPage = [
  getNavHandler({ entries: [], companyPage: [], accountPage: [] }),
  listCompaniesHandler({ items: [acme], nextCursor: null }),
  getCompanyHandler(acme),
  listMembersHandler({ items: [{ userId: bruno.id, name: bruno.name, email: bruno.email, role: "employee" }], nextCursor: null }),
];

test("a visitor sees the Company and the role, and signs up or signs in to come back to the link", async ({ worker }) => {
  worker.use(getInvitationByTokenHandler(invitation), signedOut);

  const { screen, t } = await renderSpa({ path });

  await expect.element(screen.getByRole("heading", { level: 1, name: format(t.invitations.accept.title, { companyName: "Acme" }) })).toBeVisible();
  await expect
    .element(screen.getByText(format(t.invitations.accept.description, { companyName: "Acme", role: t.companies.roles.employee })))
    .toBeVisible();
  await expect.element(screen.getByTestId("invited-email")).toHaveTextContent(format(t.invitations.accept.invitedEmail, { email: bruno.email }));
  const back = `redirect=${encodeURIComponent(path)}`;
  await expect.element(screen.getByRole("link", { name: t.invitations.accept.signUp })).toHaveAttribute("href", `/sign-up?${back}`);
  await expect.element(screen.getByRole("link", { name: t.invitations.accept.signIn })).toHaveAttribute("href", `/sign-in?${back}`);
  await expect.element(screen.getByRole("button", { name: t.invitations.accept.submit })).not.toBeInTheDocument();
});

test("signed in with the invited email, the user accepts and lands on the Company", async ({ worker }) => {
  const accepted: string[] = [];
  worker.use(
    getInvitationByTokenHandler(invitation),
    getMeHandler(bruno),
    acceptInvitationHandler(({ params }) => {
      accepted.push(String(params.token));
      return Response.json(acme);
    }),
    ...companyPage,
  );
  const { screen, router, t } = await renderSpa({ path });

  await screen.getByRole("button", { name: t.invitations.accept.submit }).click();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
  expect(router.state.location.pathname).toBe(`/c/${acme.id}`);
  expect(accepted).toEqual([token]);
});

test("an expired or canceled Invitation shows why, translated by its code", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  worker.use(
    getInvitationByTokenHandler(() =>
      getInvitationByTokenHandlerResponse410({ code: "INVITATION_EXPIRED", message: errorMessages.INVITATION_EXPIRED }),
    ),
    getMeHandler(bruno),
  );

  const { screen } = await renderSpa({ path, locale: "pt-BR" });

  await expect.element(screen.getByRole("heading", { level: 1, name: t.invitations.accept.failedTitle })).toBeVisible();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.INVITATION_EXPIRED);
  await expect.element(screen.getByRole("alert")).not.toHaveTextContent(errorMessages.INVITATION_EXPIRED);
  await expect.element(screen.getByRole("button", { name: t.invitations.accept.submit })).not.toBeInTheDocument();
});

test("signed in with another email, the user sees the Invitation is for another address and switches account", async ({ worker }) => {
  const ana = { id: "user-1", name: "Ana Souza", email: "ana@example.com", pendingEmail: null };
  const signOut = signOutHandler();
  worker.use(getInvitationByTokenHandler(invitation), getMeHandler(ana), signOut.handler);
  const { screen, router, t } = await renderSpa({ path });

  await expect
    .element(screen.getByText(format(t.invitations.accept.wrongAccount, { email: ana.email, invited: bruno.email })))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: t.invitations.accept.submit })).not.toBeInTheDocument();
  worker.use(signedOut);
  await screen.getByRole("button", { name: t.invitations.accept.switchAccount }).click();

  await expect.element(screen.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  expect(signOut.requests).toHaveLength(1);
  expect(router.state.location.pathname).toBe("/sign-in");
  expect(router.state.location.search).toEqual({ redirect: path });
});

test("a Member who opens the link goes straight to the Company", async ({ worker }) => {
  worker.use(getInvitationByTokenHandler({ ...invitation, alreadyMember: true }), getMeHandler(bruno), ...companyPage);

  const { screen, router } = await renderSpa({ path });

  await expect.element(screen.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
  expect(router.state.location.pathname).toBe(`/c/${acme.id}`);
});

test("signing up from the link puts it in the verification link, and the verified screen passes it to sign-in", async ({ worker }) => {
  const signUp = signUpHandler();
  worker.use(signUp.handler, signedOut);
  const { screen, router, t } = await renderSpa({ path: `/sign-up?redirect=${encodeURIComponent(path)}` });

  await screen.getByLabelText(t.auth.signUp.name).fill(bruno.name);
  await screen.getByLabelText(t.auth.signUp.email).fill(bruno.email);
  await screen.getByLabelText(t.auth.signUp.password).fill("correct horse battery");
  await screen.getByRole("button", { name: t.auth.signUp.submit }).click();

  await expect.element(screen.getByRole("heading", { name: t.auth.checkEmail.title })).toBeVisible();
  const callbackURL = `/email-verified?redirect=${encodeURIComponent(path)}`;
  expect(signUp.requests).toEqual([{ name: bruno.name, email: bruno.email, password: "correct horse battery", callbackURL }]);

  // Better Auth checks the emailed link and redirects to the callbackURL.
  await router.navigate({ href: callbackURL });
  await screen.getByRole("link", { name: t.auth.emailVerified.signIn }).click();

  await expect.element(screen.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  expect(router.state.location.search).toEqual({ redirect: path });
});
