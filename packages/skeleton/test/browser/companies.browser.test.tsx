import { HttpResponse } from "msw";
import { createCompanyHandler } from "../../src/gen/msw/createCompanyHandler.ts";
import { deleteCompanyHandler, deleteCompanyHandlerResponse400 } from "../../src/gen/msw/deleteCompanyHandler.ts";
import { getCompanyHandler, getCompanyHandlerResponse404 } from "../../src/gen/msw/getCompanyHandler.ts";
import { getLastCompanyHandler, getLastCompanyHandlerResponse404 } from "../../src/gen/msw/getLastCompanyHandler.ts";
import { getMeHandler } from "../../src/gen/msw/getMeHandler.ts";
import { getNavHandler } from "../../src/gen/msw/getNavHandler.ts";
import { listCompaniesHandler } from "../../src/gen/msw/listCompaniesHandler.ts";
import { listMembersHandler } from "../../src/gen/msw/listMembersHandler.ts";
import { renameCompanyHandler } from "../../src/gen/msw/renameCompanyHandler.ts";
import { format, messagesFor } from "../../src/i18n/index.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

// Seam 2: the Company screens over the generated MSW handlers.

const ana = { id: "user-1", name: "Ana Souza", email: "ana@example.com" };
const acme = { id: "company-acme", name: "Acme", role: "owner", createdAt: "2026-10-24T12:00:00.000Z" };
const globex = { id: "company-globex", name: "Globex", role: "employee", createdAt: "2026-10-24T13:00:00.000Z" };
const nav = (t = messagesFor("en")) => ({
  entries: [{ label: t.account.nav, to: "/account" }],
  companyPage: [{ label: "Notes", to: "/notes" }],
});
const noLastCompany = getLastCompanyHandler(() =>
  getLastCompanyHandlerResponse404({ code: "NOT_FOUND", message: "Not found." }),
);
const members = {
  items: [
    { userId: ana.id, name: ana.name, email: ana.email, role: "owner" },
    { userId: "user-2", name: "Bruno Lima", email: "bruno@example.com", role: "employee" },
    { userId: "user-3", name: "Carla Dias", email: "carla@example.com", role: "manager" },
  ],
  nextCursor: null,
};

/**
 * The Companies API over a list the test controls: the switcher, the page, the
 * creation, the renaming and the deletion read and change it. The Company used
 * last is the first of the list.
 */
function companiesApi(companies: (typeof acme)[]) {
  const created: unknown[] = [];
  const deleted: { companyId: unknown; body: unknown }[] = [];
  return {
    created,
    deleted,
    handlers: [
      getLastCompanyHandler(() =>
        companies[0] ? HttpResponse.json(companies[0]) : getLastCompanyHandlerResponse404({ code: "NOT_FOUND", message: "Not found." }),
      ),
      getMeHandler(ana),
      getNavHandler(nav()),
      listCompaniesHandler(() => HttpResponse.json({ items: companies, nextCursor: null })),
      getCompanyHandler(({ params }) => {
        const company = companies.find(({ id }) => id === params.companyId);
        return company
          ? HttpResponse.json(company)
          : getCompanyHandlerResponse404({ code: "NOT_FOUND", message: "Not found." });
      }),
      listMembersHandler(members),
      createCompanyHandler(async ({ request }) => {
        const body = await request.json();
        created.push(body);
        const company = { id: `company-${created.length}`, name: body.name.trim(), role: "owner", createdAt: acme.createdAt };
        companies.push(company);
        return HttpResponse.json(company, { status: 201 });
      }),
      renameCompanyHandler(async ({ request, params }) => {
        const company = companies.find(({ id }) => id === params.companyId)!;
        company.name = (await request.json()).name.trim();
        return HttpResponse.json(company);
      }),
      deleteCompanyHandler(async ({ request, params }) => {
        deleted.push({ companyId: params.companyId, body: await request.json() });
        companies.splice(companies.findIndex(({ id }) => id === params.companyId), 1);
        return new HttpResponse(null, { status: 204 });
      }),
    ],
  };
}

test("without a Company, the signed-in root asks to create one or wait for an invitation", async ({ worker }) => {
  worker.use(...companiesApi([]).handlers, noLastCompany);

  const { screen, router, t } = await renderSpa();

  await expect.element(screen.getByRole("heading", { name: format(t.home.title, { name: ana.name }) })).toBeVisible();
  await expect.element(screen.getByTestId("no-company")).toHaveTextContent(t.home.noCompany);
  await expect.element(screen.getByRole("button", { name: t.companies.create.submit })).toBeVisible();
  await expect.element(screen.getByRole("combobox", { name: t.companies.switcher.label })).not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/");
});

test("creating a Company from the root enters it: its page, with the user as Owner", async ({ worker }) => {
  const api = companiesApi([]);
  worker.use(...api.handlers, noLastCompany);
  const { screen, router, t } = await renderSpa();

  await screen.getByLabelText(t.companies.create.name).fill("  Initech  ");
  await screen.getByRole("button", { name: t.companies.create.submit }).click();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Initech" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/c/company-1");
  expect(api.created).toEqual([{ name: "  Initech  " }]);
  await expect.element(screen.getByTestId("company-role")).toHaveTextContent(format(t.companies.page.role, { role: t.companies.roles.owner }));
  await expect.element(screen.getByRole("combobox", { name: t.companies.switcher.label })).toHaveValue("company-1");
});

test("a refused Company name is shown translated by its code", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  worker.use(...companiesApi([]).handlers, noLastCompany);
  worker.use(
    getNavHandler(nav(t)),
    createCompanyHandler(() => HttpResponse.json({ code: "VALIDATION_FAILED", message: "The request is invalid." }, { status: 400 })),
  );
  const { screen } = await renderSpa({ locale: "pt-BR" });

  await screen.getByLabelText(t.companies.create.name).fill("   ");
  await screen.getByRole("button", { name: t.companies.create.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.VALIDATION_FAILED);
  await expect.element(screen.getByRole("alert")).not.toHaveTextContent("The request is invalid.");
});

test("the signed-in root goes to the Company used last", async ({ worker }) => {
  worker.use(...companiesApi([acme, globex]).handlers);
  worker.use(getLastCompanyHandler(globex));

  const { screen, router } = await renderSpa();

  await expect.element(screen.getByRole("heading", { level: 1, name: globex.name })).toBeVisible();
  expect(router.state.location.pathname).toBe(`/c/${globex.id}`);
});

test("the switcher lists the user's Companies and changes the active one through the URL", async ({ worker }) => {
  worker.use(...companiesApi([acme, globex]).handlers);
  const { screen, router, t } = await renderSpa({ path: `/c/${acme.id}` });

  const switcher = screen.getByRole("combobox", { name: t.companies.switcher.label });
  await expect.element(switcher).toHaveValue(acme.id);
  await expect.element(switcher.getByRole("option", { name: globex.name })).toBeInTheDocument();
  await switcher.selectOptions(globex.id);

  await expect.element(screen.getByRole("heading", { level: 1, name: globex.name })).toBeVisible();
  expect(router.state.location.pathname).toBe(`/c/${globex.id}`);
  await expect.element(screen.getByTestId("company-role")).toHaveTextContent(format(t.companies.page.role, { role: t.companies.roles.employee }));
});

test("the switcher's New Company opens the creation form", async ({ worker }) => {
  worker.use(...companiesApi([acme]).handlers);
  const { screen, router, t } = await renderSpa({ path: `/c/${acme.id}` });

  await screen.getByRole("link", { name: t.companies.switcher.new }).click();

  await expect.element(screen.getByRole("heading", { name: t.companies.create.title })).toBeVisible();
  expect(router.state.location.pathname).toBe("/c/new");
});

test("the Company page shows the features' sections and the Members with name, email and role", async ({ worker }) => {
  worker.use(...companiesApi([acme]).handlers);
  const { screen, t } = await renderSpa({ path: `/c/${acme.id}` });

  const sections = screen.getByRole("navigation", { name: t.companies.page.sections });
  await expect.element(sections.getByRole("link", { name: "Notes" })).toHaveAttribute("href", `/c/${acme.id}/notes`);
  const table = screen.getByRole("table", { name: t.companies.page.members });
  await expect.element(table.getByRole("columnheader", { name: t.companies.page.memberEmail })).toBeVisible();
  await expect.element(table.getByRole("row", { name: `${ana.name} ${ana.email} ${t.companies.roles.owner}` })).toBeVisible();
  expect(table.getByRole("row").elements()).toHaveLength(4);
  await expect.element(table.getByRole("row", { name: `Bruno Lima bruno@example.com ${t.companies.roles.employee}` })).toBeVisible();
  // A role the Product added shows as stored.
  await expect.element(table.getByRole("row", { name: "Carla Dias carla@example.com manager" })).toBeVisible();
});

test("a Company the user is not a Member of is not found", async ({ worker }) => {
  worker.use(...companiesApi([acme]).handlers);

  const { screen, t } = await renderSpa({ path: "/c/someone-elses" });

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.NOT_FOUND);
});

test("an Employee sees none of the Owner's actions", async ({ worker }) => {
  worker.use(...companiesApi([{ ...globex }]).handlers);
  const { screen, t } = await renderSpa({ path: `/c/${globex.id}` });

  await expect.element(screen.getByRole("heading", { level: 1, name: globex.name })).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: t.companies.settings.title })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: t.companies.settings.rename.submit })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: t.companies.settings.delete.submit })).not.toBeInTheDocument();
});

test("the Owner renames the Company: the page and the switcher show the new name, at the same URL", async ({ worker }) => {
  worker.use(...companiesApi([{ ...acme }]).handlers);
  const { screen, router, t } = await renderSpa({ path: `/c/${acme.id}` });

  const name = screen.getByLabelText(t.companies.settings.rename.name);
  await expect.element(name).toHaveValue(acme.name);
  await name.fill("  Acme Corp  ");
  await screen.getByRole("button", { name: t.companies.settings.rename.submit }).click();

  await expect.element(screen.getByRole("heading", { level: 1, name: "Acme Corp" })).toBeVisible();
  await expect.element(screen.getByRole("status")).toHaveTextContent(t.companies.settings.rename.saved);
  await expect.element(name).toHaveValue("Acme Corp");
  await expect
    .element(screen.getByRole("combobox", { name: t.companies.switcher.label }).getByRole("option", { name: "Acme Corp" }))
    .toBeInTheDocument();
  expect(router.state.location.pathname).toBe(`/c/${acme.id}`);
});

test("a refused new name is shown translated by its code", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  worker.use(...companiesApi([{ ...acme }]).handlers);
  worker.use(
    getNavHandler(nav(t)),
    renameCompanyHandler(() => HttpResponse.json({ code: "FORBIDDEN", message: "Your role does not allow this." }, { status: 403 })),
  );
  const { screen } = await renderSpa({ path: `/c/${acme.id}`, locale: "pt-BR" });

  await screen.getByRole("button", { name: t.companies.settings.rename.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.FORBIDDEN);
});

test("deleting asks for the Company's name and goes to another Company once it is deleted", async ({ worker }) => {
  const api = companiesApi([{ ...acme }, { ...globex }]);
  worker.use(...api.handlers);
  const { screen, router, t } = await renderSpa({ path: `/c/${acme.id}` });

  const confirmation = screen.getByLabelText(format(t.companies.settings.delete.confirm, { name: acme.name }));
  const submit = screen.getByRole("button", { name: t.companies.settings.delete.submit });
  await expect.element(submit).toBeDisabled();
  await confirmation.fill("Acme");
  await submit.click();

  await expect.element(screen.getByRole("heading", { level: 1, name: globex.name })).toBeVisible();
  expect(router.state.location.pathname).toBe(`/c/${globex.id}`);
  expect(api.deleted).toEqual([{ companyId: acme.id, body: { name: "Acme" } }]);
  await expect
    .element(screen.getByRole("combobox", { name: t.companies.switcher.label }).getByRole("option", { name: acme.name }))
    .not.toBeInTheDocument();
});

test("deleting the last Company leads to the screen without a Company", async ({ worker }) => {
  worker.use(...companiesApi([{ ...acme }]).handlers);
  const { screen, router, t } = await renderSpa({ path: `/c/${acme.id}` });

  await screen.getByLabelText(format(t.companies.settings.delete.confirm, { name: acme.name })).fill("Acme");
  await screen.getByRole("button", { name: t.companies.settings.delete.submit }).click();

  await expect.element(screen.getByTestId("no-company")).toHaveTextContent(t.home.noCompany);
  expect(router.state.location.pathname).toBe("/");
});

test("a confirmation the API refuses is shown translated, and the Company stays open", async ({ worker }) => {
  worker.use(...companiesApi([{ ...acme }]).handlers);
  worker.use(
    deleteCompanyHandler(() =>
      deleteCompanyHandlerResponse400({ code: "CONFIRMATION_MISMATCH", message: "The confirmation does not match the Company's name." }),
    ),
  );
  const { screen, router, t } = await renderSpa({ path: `/c/${acme.id}` });

  await screen.getByLabelText(format(t.companies.settings.delete.confirm, { name: acme.name })).fill("Acme");
  await screen.getByRole("button", { name: t.companies.settings.delete.submit }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.CONFIRMATION_MISMATCH);
  expect(router.state.location.pathname).toBe(`/c/${acme.id}`);
});
