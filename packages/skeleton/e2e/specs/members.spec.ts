import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { format, type Messages } from "../../src/i18n/index.ts";
import { buyPlan, expect, linkIn, test, type Mailbox } from "../index.ts";

const password = "correct horse battery";

/**
 * The headers of a sign-up or sign-in through the API. Better Auth allows 3 of
 * each per 10 seconds and client IP, and this test makes more: each comes from an IP of its own.
 */
const authHeaders = (origin: string) => ({
  origin,
  "cf-connecting-ip": `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 256)).join(".")}`,
});

/** Signs up `email` through the API and verifies it, then signs out: the account is ready to sign in. */
async function account(page: Page, { t, mailbox, origin }: { t: Messages; mailbox: Mailbox; origin: string }, name: string, email: string) {
  const signUp = await page.request.post("/api/auth/sign-up/email", { headers: authHeaders(origin), data: { name, email, password } });
  expect(signUp.ok()).toBe(true);
  const verification = await mailbox.latest(email, { subject: t.emails.verifyEmail.subject });
  expect((await page.request.get(linkIn(verification.html, "/api/auth/verify-email"))).ok()).toBe(true);
  await page.context().clearCookies();
}

/** Signs `email` in through the API, in place of whoever was signed in on the page. */
async function signIn(page: Page, origin: string, email: string) {
  await page.context().clearCookies();
  expect((await page.request.post("/api/auth/sign-in/email", { headers: authHeaders(origin), data: { email, password } })).ok()).toBe(true);
}

test(
  "the Owner removes a Member who joined by Invitation, and an Employee leaves",
  { tag: "@evidence" },
  async ({ page, baseURL, t, mailbox, evidence }) => {
    const origin = baseURL!;
    const context = { t, mailbox, origin };
    const [ana, bruno, carla] = ["owner", "bruno", "carla"].map((who) => `${who}-${randomUUID()}@example.com`) as [string, string, string];

    // Ana, Owner of Acme, invites Bruno and Carla as Employees, and both accept from the email's link.
    await account(page, context, "Ana Souza", ana);
    await signIn(page, origin, ana);
    await buyPlan(page.request, origin);
    const company = (await (await page.request.post("/api/companies", { headers: { origin }, data: { name: "Acme" } })).json()) as {
      id: string;
    };
    for (const email of [bruno, carla]) {
      const invited = await page.request.post(`/api/companies/${company.id}/invitations`, {
        headers: { origin },
        data: { email, role: "employee" },
      });
      expect(invited.status()).toBe(201);
    }
    for (const [name, email] of [["Bruno Lima", bruno], ["Carla Dias", carla]] as const) {
      const invitation = await mailbox.latest(email, {
        subject: format(t.emails.invitation.subject, { inviterName: "Ana Souza", companyName: "Acme" }),
      });
      const token = linkIn(invitation.html, "/invitations/").split("/invitations/")[1]!;
      await account(page, context, name, email);
      await signIn(page, origin, email);
      expect((await page.request.post(`/api/invitations/${token}/accept`, { headers: { origin } })).status()).toBe(200);
    }

    // The Owner sees, on every other Member's row, the role choice and Remove.
    await signIn(page, origin, ana);
    await page.goto(`/c/${company.id}`);
    const members = page.getByRole("table", { name: t.companies.page.members });
    await expect(members.getByRole("combobox", { name: format(t.companies.members.roleOf, { name: "Bruno Lima" }) })).toHaveValue("employee");
    await expect(members.getByRole("button", { name: format(t.companies.members.remove, { name: "Carla Dias" }) })).toBeVisible();
    await expect(members.getByRole("button", { name: format(t.companies.members.remove, { name: "Ana Souza" }) })).toHaveCount(0);
    await evidence("owner-member-actions");

    // She removes Bruno: he leaves the table, and the Company is gone for him.
    await members.getByRole("button", { name: format(t.companies.members.remove, { name: "Bruno Lima" }) }).click();
    await expect(page.getByRole("status")).toHaveText(format(t.companies.members.removed, { name: "Bruno Lima" }));
    await expect(members.getByRole("row").filter({ hasText: bruno })).toHaveCount(0);
    await evidence("member-removed");
    await signIn(page, origin, bruno);
    expect((await page.request.get(`/api/companies/${company.id}`)).status()).toBe(404);

    // Carla, an Employee, sees only Leave; she leaves and lands where a user without a Company does.
    await signIn(page, origin, carla);
    await page.goto(`/c/${company.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
    await expect(members.getByRole("row")).toHaveCount(3);
    await expect(members.getByRole("button")).toHaveCount(0);
    await expect(members.getByRole("combobox")).toHaveCount(0);
    await evidence("employee-leave");
    await page.getByRole("button", { name: t.companies.leave.submit }).click();
    await expect(page.getByTestId("no-company")).toHaveText(t.home.noCompany);
    expect((await page.request.get(`/api/companies/${company.id}`)).status()).toBe(404);
    await evidence("employee-left");
  },
);
