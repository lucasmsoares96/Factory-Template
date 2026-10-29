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

test(
  "when the Owner's Subscription ends the newest Member is suspended: a screen for them, a mark for the Owner",
  { tag: "@evidence" },
  async ({ page, baseURL, t, mailbox, evidence }) => {
    const origin = baseURL!;
    const context = { t, mailbox, origin };
    const ana = `owner-${randomUUID()}@example.com`;
    const bruno = `bruno-${randomUUID()}@example.com`;

    // Ana buys a Plan, creates Acme and invites Bruno, who accepts from the email's link.
    await account(page, context, "Ana Souza", ana);
    await signIn(page, origin, ana);
    await buyPlan(page.request, origin);
    const company = (await (await page.request.post("/api/companies", { headers: { origin }, data: { name: "Acme" } })).json()) as { id: string };
    const invited = await page.request.post(`/api/companies/${company.id}/invitations`, { headers: { origin }, data: { email: bruno, role: "employee" } });
    expect(invited.status()).toBe(201);
    const invitation = await mailbox.latest(bruno, { subject: format(t.emails.invitation.subject, { inviterName: "Ana Souza", companyName: "Acme" }) });
    const token = linkIn(invitation.html, "/invitations/").split("/invitations/")[1]!;
    await account(page, context, "Bruno Lima", bruno);
    await signIn(page, origin, bruno);
    expect((await page.request.post(`/api/invitations/${token}/accept`, { headers: { origin } })).status()).toBe(200);

    // Stripe ends the Subscription: Ana is back to one Seat, her own, so Bruno loses access.
    const ended = await page.request.post("/api/fake-stripe/control/end-subscriptions", { data: { email: ana } });
    expect(await ended.json()).toEqual({ ended: 1 });

    // Bruno sees the suspension screen, not the Company.
    await page.goto(`/c/${company.id}`);
    await expect(page.getByTestId("company-suspended").getByRole("heading", { level: 1 })).toHaveText(format(t.companies.suspended.title, { name: "Acme" }));
    await evidence("suspended-screen");

    // Ana sees Bruno marked "no access" in the Members, and can remove him.
    await signIn(page, origin, ana);
    await page.goto(`/c/${company.id}`);
    const members = page.getByRole("table", { name: t.companies.page.members });
    await expect(members.getByRole("row").filter({ hasText: bruno }).getByTestId("member-suspended")).toHaveText(t.companies.members.suspendedMark);
    await expect(members.getByRole("row").filter({ hasText: ana }).getByTestId("member-suspended")).toHaveCount(0);
    await evidence("suspended-mark");
    await members.getByRole("button", { name: format(t.companies.members.remove, { name: "Bruno Lima" }) }).click();
    await expect(page.getByRole("status")).toHaveText(format(t.companies.members.removed, { name: "Bruno Lima" }));
  },
);
