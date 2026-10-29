import { randomUUID } from "node:crypto";
import { buyPlan, expect, linkIn, test, type Mailbox } from "@workspace/skeleton/e2e";
import { format, type Messages } from "@workspace/skeleton/i18n";
import type { Page } from "@playwright/test";

const password = "correct horse battery";

/** A verified, signed-in Owner on a paid Plan with one pending Invitation, who therefore has two Seats in use. */
async function paidOwner(page: Page, origin: string, t: Messages, mailbox: Mailbox) {
  const email = `payer-${randomUUID()}@example.com`;
  const signUp = await page.request.post("/api/auth/sign-up/email", { headers: { origin }, data: { name: "Ana Souza", email, password, callbackURL: "/email-verified" } });
  expect(signUp.ok()).toBe(true);
  const verification = await mailbox.latest(email, { subject: t.emails.verifyEmail.subject });
  expect((await page.request.get(linkIn(verification.html, "/api/auth/verify-email"))).ok()).toBe(true);
  await page.goto("/sign-in");
  await page.getByLabel(t.auth.signIn.email).fill(email);
  await page.getByLabel(t.auth.signIn.password).fill(password);
  await page.getByRole("button", { name: t.auth.signIn.submit }).click();
  await expect(page).toHaveURL(/\/$/);
  await buyPlan(page.request, origin);
  const company = (await (await page.request.post("/api/companies", { headers: { origin }, data: { name: "Acme" } })).json()) as { id: string };
  const invited = await page.request.post(`/api/companies/${company.id}/invitations`, { headers: { origin }, data: { email: `guest-${randomUUID()}@example.com`, role: "employee" } });
  expect(invited.status()).toBe(201);
  return email;
}

test("canceling asks for confirmation with the date and the people, and the Plan page then says it will not renew", { tag: "@evidence" }, async ({ page, baseURL, t, mailbox, evidence }) => {
  await paidOwner(page, baseURL!, t, mailbox);
  await page.goto("/account/plan");
  await expect(page.getByTestId("current-plan-name")).toHaveText(t.billing.seed.team.name);

  await page.getByRole("button", { name: t.billing.cancel }).click();
  const confirmation = page.getByTestId("cancel-confirmation");
  await expect(confirmation).toBeVisible();
  await expect(page.getByTestId("cancel-people")).toHaveText(format(t.billing.cancelPeopleOne, { count: "1" }));
  await evidence("cancel-confirmation");

  await confirmation.getByRole("button", { name: t.billing.cancelConfirm }).click();

  await expect(page.getByTestId("ends-notice")).toBeVisible();
  await expect(page.getByTestId("current-plan-name")).toHaveText(t.billing.seed.team.name);
  await expect(page.getByRole("button", { name: t.billing.cancel })).toHaveCount(0);
  await evidence("canceled");
});

test("a failed payment shows the Owner until when to update the card, and the Plan stays", { tag: "@evidence" }, async ({ page, baseURL, t, mailbox, evidence }) => {
  const email = await paidOwner(page, baseURL!, t, mailbox);
  await page.goto("/account/plan");
  await expect(page.getByTestId("past-due-notice")).toHaveCount(0);

  const failed = await page.request.post("/api/fake-stripe/control/fail-payment", { data: { email } });
  expect(await failed.json()).toEqual({ failed: 1 });
  await page.reload();

  await expect(page.getByTestId("past-due-notice")).toBeVisible();
  await expect(page.getByTestId("current-plan-name")).toHaveText(t.billing.seed.team.name);
  await evidence("past-due");
});
