import { HttpResponse } from "msw";
import { createCompanyHandler } from "../../src/gen/msw/createCompanyHandler.ts";
import { getCompanyHandler, getCompanyHandlerResponse404 } from "../../src/gen/msw/getCompanyHandler.ts";
import { getLastCompanyHandler, getLastCompanyHandlerResponse404 } from "../../src/gen/msw/getLastCompanyHandler.ts";
import { getMeHandler } from "../../src/gen/msw/getMeHandler.ts";
import { getNavHandler } from "../../src/gen/msw/getNavHandler.ts";
import { listCompaniesHandler } from "../../src/gen/msw/listCompaniesHandler.ts";
import { listMembersHandler } from "../../src/gen/msw/listMembersHandler.ts";
import { format, messagesFor } from "../../src/i18n/index.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

// Seam 2: the Company screens over the generated MSW handlers.

const ana = { id: "user-1", name: "Ana Souza", email: "ana@example.com", pendingEmail: null };
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

/** The Companies API over a list the test controls: the switcher, the page and the creation read and change it. */
function companiesApi(companies: (typeof acme)[]) {
  const created: unknown[] = [];
  return {
    created,
    handlers: [
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
  worker.use(...companiesApi([acme, globex]).handlers, getLastCompanyHandler(globex));

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
