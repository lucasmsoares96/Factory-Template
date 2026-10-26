import { randomUUID } from "node:crypto";
import { format } from "../../src/i18n/index.ts";
import { expect, linkIn, test } from "../index.ts";

test("a signed-in user creates a Company and enters it", { tag: "@evidence" }, async ({ page, baseURL, t, mailbox, evidence }) => {
  const email = `founder-${randomUUID()}@example.com`;
  const password = "correct horse battery";

  // A verified user, signed in through the screen.
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: baseURL! },
    data: { name: "Ana Souza", email, password, callbackURL: "/email-verified" },
  });
  expect(signUp.ok()).toBe(true);
  const verification = await mailbox.latest(email, { subject: t.emails.verifyEmail.subject });
  expect((await page.request.get(linkIn(verification.html, "/api/auth/verify-email"))).ok()).toBe(true);
  await page.goto("/sign-in");
  await page.getByLabel(t.auth.signIn.email).fill(email);
  await page.getByLabel(t.auth.signIn.password).fill(password);
  await page.getByRole("button", { name: t.auth.signIn.submit }).click();

  // In no Company yet: the root asks to create one or wait for an invitation.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("no-company")).toHaveText(t.home.noCompany);
  await evidence("no-company");

  await page.getByLabel(t.companies.create.name).fill("  Acme  ");
  await page.getByRole("button", { name: t.companies.create.submit }).click();
  await expect(page).toHaveURL(/\/c\/[^/]+$/);
  const acmeUrl = page.url();
  await expect(page.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
  const members = page.getByRole("table", { name: t.companies.page.members });
  await expect(members.getByRole("row", { name: `Ana Souza ${email} ${t.companies.roles.owner}` })).toBeVisible();
  await evidence("company-page");

  // A second Company, from the switcher; the switcher then goes back to the first.
  await page.getByRole("link", { name: t.companies.switcher.new }).click();
  await expect(page.getByRole("heading", { name: t.companies.create.title })).toBeVisible();
  await page.getByLabel(t.companies.create.name).fill("Globex");
  await page.getByRole("button", { name: t.companies.create.submit }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Globex" })).toBeVisible();
  const switcher = page.getByRole("combobox", { name: t.companies.switcher.label });
  await expect(switcher.getByRole("option")).toHaveText(["Acme", "Globex"]);
  await evidence("company-switcher");
  await switcher.selectOption({ label: "Acme" });
  await expect(page).toHaveURL(acmeUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();

  // Back at the root, the user lands in the Company they used last.
  await page.goto("/");
  await expect(page).toHaveURL(acmeUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
});

test("the Owner renames and deletes a Company", { tag: "@evidence" }, async ({ page, baseURL, t, mailbox, evidence }) => {
  const email = `owner-${randomUUID()}@example.com`;
  const password = "correct horse battery";
  const settings = t.companies.settings;

  // A verified user, signed in through the screen, with two Companies.
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: baseURL! },
    data: { name: "Ana Souza", email, password, callbackURL: "/email-verified" },
  });
  expect(signUp.ok()).toBe(true);
  const verification = await mailbox.latest(email, { subject: t.emails.verifyEmail.subject });
  expect((await page.request.get(linkIn(verification.html, "/api/auth/verify-email"))).ok()).toBe(true);
  await page.goto("/sign-in");
  await page.getByLabel(t.auth.signIn.email).fill(email);
  await page.getByLabel(t.auth.signIn.password).fill(password);
  await page.getByRole("button", { name: t.auth.signIn.submit }).click();
  await page.getByLabel(t.companies.create.name).fill("Acme");
  await page.getByRole("button", { name: t.companies.create.submit }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
  const acmeUrl = page.url();
  await page.getByRole("link", { name: t.companies.switcher.new }).click();
  await expect(page.getByRole("heading", { name: t.companies.create.title })).toBeVisible();
  await page.getByLabel(t.companies.create.name).fill("Globex");
  await page.getByRole("button", { name: t.companies.create.submit }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Globex" })).toBeVisible();
  const globexUrl = page.url();

  // Renamed, the Company keeps its link.
  await page.getByLabel(settings.rename.name).fill("Globex Corp");
  await page.getByRole("button", { name: settings.rename.submit }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Globex Corp" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(settings.rename.saved);
  expect(page.url()).toBe(globexUrl);
  await expect(page.getByRole("combobox", { name: t.companies.switcher.label }).getByRole("option")).toHaveText(["Acme", "Globex Corp"]);
  await evidence("company-renamed");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Globex Corp" })).toBeVisible();

  // Deleting asks for the current name; then the user goes to their other Company.
  const deleteButton = page.getByRole("button", { name: settings.delete.submit });
  const confirmation = page.getByLabel(format(settings.delete.confirm, { name: "Globex Corp" }));
  await confirmation.fill("Globex");
  await expect(deleteButton).toBeDisabled();
  await confirmation.fill("Globex Corp");
  await expect(deleteButton).toBeEnabled();
  await evidence("company-delete-confirmation");
  await deleteButton.click();
  await expect(page).toHaveURL(acmeUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: t.companies.switcher.label }).getByRole("option")).toHaveText(["Acme"]);

  // The deleted Company's link finds nothing.
  await page.goto(globexUrl);
  await expect(page.getByRole("alert")).toHaveText(t.errors.NOT_FOUND);

  // Deleting the last Company leads to the screen without a Company.
  await page.goto(acmeUrl);
  await page.getByLabel(format(settings.delete.confirm, { name: "Acme" })).fill("Acme");
  await page.getByRole("button", { name: settings.delete.submit }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("no-company")).toHaveText(t.home.noCompany);
  await evidence("company-deleted");
});
