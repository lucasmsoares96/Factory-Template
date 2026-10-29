import { HttpResponse } from "msw";
import { cancelInvitationHandler } from "../../src/gen/msw/cancelInvitationHandler.ts";
import { createInvitationHandler, createInvitationHandlerResponse409 } from "../../src/gen/msw/createInvitationHandler.ts";
import { getCompanyHandler } from "../../src/gen/msw/getCompanyHandler.ts";
import { getMeHandler } from "../../src/gen/msw/getMeHandler.ts";
import { getNavHandler } from "../../src/gen/msw/getNavHandler.ts";
import { listCompaniesHandler } from "../../src/gen/msw/listCompaniesHandler.ts";
import { listInvitationsHandler } from "../../src/gen/msw/listInvitationsHandler.ts";
import { listMembersHandler } from "../../src/gen/msw/listMembersHandler.ts";
import { resendInvitationHandler } from "../../src/gen/msw/resendInvitationHandler.ts";
import { format, messagesFor } from "../../src/i18n/index.ts";
import { errorMessages } from "../../src/platform/error-codes.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

// Seam 2: the Invitations section of the Company page over the generated MSW handlers.

const ana = { id: "user-1", name: "Ana Souza", email: "ana@example.com", pendingEmail: null };
const acme = { id: "company-acme", name: "Acme", role: "owner", createdAt: "2026-10-24T12:00:00.000Z" };
const expiresAt = "2026-10-31T12:00:00.000Z";
const invitation = (email: string, invitedBy: { userId: string; name: string } | null = { userId: ana.id, name: ana.name }) => ({
  id: `invitation-${email}`,
  email,
  role: "employee",
  invitedBy,
  expiresAt,
  createdAt: "2026-10-24T12:00:00.000Z",
});
type Invitation = ReturnType<typeof invitation>;

/** The Company page's API, with the pending Invitations in a list the test controls. */
function companyApi(pending: Invitation[], { role = "owner", t = messagesFor("en") } = {}) {
  const requests: { method: string; path: string; body?: unknown }[] = [];
  const company = { ...acme, role };
  return {
    requests,
    handlers: [
      getMeHandler(ana),
      getNavHandler({ entries: [{ label: t.account.nav, to: "/account" }], companyPage: [], accountPage: [] }),
      listCompaniesHandler({ items: [company], nextCursor: null }),
      getCompanyHandler(company),
      listMembersHandler({ items: [{ userId: ana.id, name: ana.name, email: ana.email, role, suspended: false }], nextCursor: null }),
      listInvitationsHandler(() => HttpResponse.json({ items: pending, nextCursor: null })),
      createInvitationHandler(async ({ request, params }) => {
        const body = await request.json();
        requests.push({ method: "POST", path: `${params.companyId}/invitations`, body });
        const created = invitation(body.email.toLowerCase());
        pending.push(created);
        return HttpResponse.json(created, { status: 201 });
      }),
      resendInvitationHandler(({ params }) => {
        requests.push({ method: "POST", path: `${params.invitationId}/resend` });
        return HttpResponse.json(pending.find(({ id }) => id === params.invitationId));
      }),
      cancelInvitationHandler(({ params }) => {
        requests.push({ method: "DELETE", path: `${params.invitationId}` });
        pending.splice(pending.findIndex(({ id }) => id === params.invitationId), 1);
        return new HttpResponse(null, { status: 204 });
      }),
    ],
  };
}

test("the Owner sees the pending Invitations with email, role, who invited and the expiry", async ({ worker }) => {
  worker.use(...companyApi([invitation("bruno@example.com"), invitation("carla@example.com", null)]).handlers);

  const { screen, t } = await renderSpa({ path: `/c/${acme.id}` });

  const table = screen.getByRole("table", { name: t.invitations.pending });
  await expect.element(table.getByRole("columnheader", { name: t.invitations.invitedBy })).toBeVisible();
  const expires = new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(expiresAt));
  const actions = `${t.invitations.resend} ${t.invitations.cancel}`;
  await expect
    .element(table.getByRole("row", { name: `bruno@example.com ${t.companies.roles.employee} ${ana.name} ${expires} ${actions}` }))
    .toBeVisible();
  // The account of whoever invited is gone; the Invitation stays.
  await expect
    .element(table.getByRole("row", { name: `carla@example.com ${t.companies.roles.employee} ${t.invitations.deletedInviter} ${expires} ${actions}` }))
    .toBeVisible();
});

test("the Owner invites an address with a role, and the Invitation joins the pending list", async ({ worker }) => {
  const api = companyApi([]);
  worker.use(...api.handlers);
  const { screen, t } = await renderSpa({ path: `/c/${acme.id}` });
  await expect.element(screen.getByText(t.invitations.empty)).toBeVisible();

  await screen.getByLabelText(t.invitations.email).fill("bruno@example.com");
  await expect.element(screen.getByRole("combobox", { name: t.invitations.role })).toHaveValue("employee");
  await screen.getByRole("button", { name: t.invitations.submit }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent(format(t.invitations.sent, { email: "bruno@example.com" }));
  expect(api.requests).toEqual([{ method: "POST", path: `${acme.id}/invitations`, body: { email: "bruno@example.com", role: "employee" } }]);
  const table = screen.getByRole("table", { name: t.invitations.pending });
  await expect.element(table.getByRole("cell", { name: "bruno@example.com" })).toBeVisible();
  await expect.element(screen.getByLabelText(t.invitations.email)).toHaveValue("");
});

test("the role list never offers owner", async ({ worker }) => {
  worker.use(...companyApi([]).handlers);
  const { screen, t } = await renderSpa({ path: `/c/${acme.id}` });

  const role = screen.getByRole("combobox", { name: t.invitations.role });
  await expect.element(role.getByRole("option", { name: t.companies.roles.employee })).toBeInTheDocument();
  await expect.element(role.getByRole("option", { name: t.companies.roles.owner })).not.toBeInTheDocument();
});

test("a refused Invitation is shown translated by its code", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  worker.use(...companyApi([], { t }).handlers);
  worker.use(
    createInvitationHandler(() =>
      createInvitationHandlerResponse409({
        code: "INVITATION_PENDING",
        message: errorMessages.INVITATION_PENDING,
      }),
    ),
  );
  const { screen } = await renderSpa({ path: `/c/${acme.id}`, locale: "pt-BR" });

  await screen.getByLabelText(t.invitations.email).fill("bruno@example.com");
  await screen.getByRole("button", { name: t.invitations.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.INVITATION_PENDING);
  await expect.element(screen.getByRole("alert")).not.toHaveTextContent(errorMessages.INVITATION_PENDING);
});

test("the Owner resends an Invitation, and cancels another, which leaves the list", async ({ worker }) => {
  const api = companyApi([invitation("bruno@example.com"), invitation("carla@example.com")]);
  worker.use(...api.handlers);
  const { screen, t } = await renderSpa({ path: `/c/${acme.id}` });
  const table = screen.getByRole("table", { name: t.invitations.pending });
  const bruno = table.getByRole("row").filter({ hasText: "bruno@example.com" });
  const carla = table.getByRole("row").filter({ hasText: "carla@example.com" });

  await bruno.getByRole("button", { name: t.invitations.resend }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent(format(t.invitations.resent, { email: "bruno@example.com" }));

  await carla.getByRole("button", { name: t.invitations.cancel }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent(format(t.invitations.canceled, { email: "carla@example.com" }));
  await expect.element(table.getByRole("cell", { name: "carla@example.com" })).not.toBeInTheDocument();
  await expect.element(table.getByRole("cell", { name: "bruno@example.com" })).toBeVisible();
  expect(api.requests).toEqual([
    { method: "POST", path: "invitation-bruno@example.com/resend" },
    { method: "DELETE", path: "invitation-carla@example.com" },
  ]);
});

test("an Employee does not see the Invitations at all", async ({ worker }) => {
  const api = companyApi([invitation("bruno@example.com")], { role: "employee" });
  worker.use(...api.handlers);
  const { screen, t } = await renderSpa({ path: `/c/${acme.id}` });

  await expect.element(screen.getByRole("heading", { level: 1, name: acme.name })).toBeVisible();
  await expect.element(screen.getByRole("table", { name: t.companies.page.members })).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: t.invitations.title, exact: true })).not.toBeInTheDocument();
  await expect.element(screen.getByLabelText(t.invitations.email)).not.toBeInTheDocument();
});
