import { randomUUID } from "node:crypto";
import { buyPlan, expect, linkIn, test, type Mailbox } from "@workspace/skeleton/e2e";
import { format, type Messages } from "@workspace/skeleton/i18n";
import type { Page } from "@playwright/test";

const password = "correct horse battery";

/** Better Auth limits sign-ups and sign-ins per client IP: each call here comes from an IP of its own. */
const authHeaders = (origin: string) => ({
  origin,
  "cf-connecting-ip": `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 256)).join(".")}`,
});

async function account(page: Page, { t, mailbox, origin }: { t: Messages; mailbox: Mailbox; origin: string }, name: string, email: string) {
  const signUp = await page.request.post("/api/auth/sign-up/email", { headers: authHeaders(origin), data: { name, email, password } });
  expect(signUp.ok()).toBe(true);
  const verification = await mailbox.latest(email, { subject: t.emails.verifyEmail.subject });
  expect((await page.request.get(linkIn(verification.html, "/api/auth/verify-email"))).ok()).toBe(true);
  await page.context().clearCookies();
}

async function signIn(page: Page, origin: string, email: string) {
  await page.context().clearCookies();
  expect((await page.request.post("/api/auth/sign-in/email", { headers: authHeaders(origin), data: { email, password } })).ok()).toBe(true);
}


/** `name` joins Ana's Company from the Invitation's link. */
async function joinCompany(page: Page, context: { t: Messages; mailbox: Mailbox; origin: string }, companyId: string, name: string, email: string) {
  const { t, mailbox, origin } = context;
  const invited = await page.request.post(`/api/companies/${companyId}/invitations`, { headers: { origin }, data: { email, role: "employee" } });
  expect(invited.status()).toBe(201);
  const invitation = await mailbox.latest(email, { subject: format(t.emails.invitation.subject, { inviterName: "Ana Souza", companyName: "Acme" }) });
  const token = linkIn(invitation.html, "/invitations/").split("/invitations/")[1]!;
  await account(page, context, name, email);
  await signIn(page, origin, email);
  expect((await page.request.post(`/api/invitations/${token}/accept`, { headers: { origin } })).status()).toBe(200);
}

test(
  "moving down warns who loses access on the date it takes effect, and only changes the Seats then",
  { tag: "@evidence" },
  async ({ page, baseURL, t, mailbox, evidence }) => {
    const origin = baseURL!;
    const context = { t, mailbox, origin };
    const ana = `owner-${randomUUID()}@example.com`;

    // Ana has the biggest Plan, a Company and three Members: four people, and the smaller Plan gives three Seats.
    await account(page, context, "Ana Souza", ana);
    await signIn(page, origin, ana);
    await buyPlan(page.request, origin);
    const company = (await (await page.request.post("/api/companies", { headers: { origin }, data: { name: "Acme" } })).json()) as { id: string };
    for (const name of ["Bruno Lima", "Carla Dias", "Davi Rocha"]) {
      await signIn(page, origin, ana);
      await joinCompany(page, context, company.id, name, `${name.split(" ")[0]!.toLowerCase()}-${randomUUID()}@example.com`);
    }
    await signIn(page, origin, ana);

    await page.goto("/account/plan");
    const pro = page.getByTestId("plan-prod_fake_pro");
    await pro.getByRole("button", { name: t.billing.change }).click();

    // The warning names how many people lose access, and nothing has changed yet.
    const confirmation = page.getByTestId("plan-change-confirm");
    await expect(confirmation.getByTestId("losing-access")).toContainText(t.billing.losingOne);
    await expect(confirmation.getByTestId("plan-change-when")).not.toHaveText(t.billing.confirmNow);
    await evidence("downgrade-warning");
    await confirmation.getByTestId("plan-change-submit").click();

    await expect(page.getByTestId("change-scheduled")).toHaveText(t.billing.scheduledDone);
    await expect(page.getByTestId("scheduled-change")).toContainText(t.billing.seed.pro.name);
    await expect(page.getByTestId("current-plan-name")).toHaveText(t.billing.seed.team.name);
    await expect(page.getByTestId("seats-usage")).toHaveText(format(t.billing.seatsUsage, { used: "4", total: "10" }));
  },
);

test("moving up goes through Stripe's confirmation page and the plan changes once it is paid", async ({ page, baseURL, t, mailbox }) => {
  const origin = baseURL!;
  const ana = `owner-${randomUUID()}@example.com`;
  await account(page, { t, mailbox, origin }, "Ana Souza", ana);
  await signIn(page, origin, ana);

  await page.goto("/account/plan");
  await page.getByTestId("plan-prod_fake_pro").getByRole("button", { name: t.billing.subscribe }).click();
  await page.getByTestId("fake-checkout-pay").click();
  await expect(page.getByTestId("current-plan-name")).toHaveText(t.billing.seed.pro.name);

  await page.getByTestId("plan-prod_fake_team").getByRole("button", { name: t.billing.change }).click();
  await expect(page.getByTestId("plan-change-when")).toHaveText(t.billing.confirmNow);
  await page.getByTestId("plan-change-submit").click();
  await expect(page.getByTestId("fake-portal-due")).toBeVisible();
  await page.getByTestId("fake-portal-pay").click();

  await expect(page).toHaveURL(/\/account\/plan/);
  await expect(page.getByTestId("current-plan-name")).toHaveText(t.billing.seed.team.name);
});
