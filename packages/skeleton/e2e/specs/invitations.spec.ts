import { randomUUID } from "node:crypto";
import { format } from "../../src/i18n/index.ts";
import { expect, linkIn, test } from "../index.ts";

test("the Owner invites someone by email and sees the pending Invitation", { tag: "@evidence" }, async ({ page, baseURL, t, mailbox, evidence }) => {
  const email = `owner-${randomUUID()}@example.com`;
  const password = "correct horse battery";
  const guest = `guest-${randomUUID()}@example.com`;

  // A verified user, signed in through the screen, Owner of a new Company.
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

  // The Owner invites an address as an Employee.
  await expect(page.getByRole("heading", { name: t.invitations.title, exact: true })).toBeVisible();
  await page.getByLabel(t.invitations.email).fill(guest);
  await page.getByLabel(t.invitations.role).selectOption("employee");
  await evidence("invite-form");
  await page.getByRole("button", { name: t.invitations.submit }).click();
  await expect(page.getByRole("status")).toHaveText(format(t.invitations.sent, { email: guest }));

  // The Invitation is pending: email, role, who invited and when it expires.
  const pending = page.getByRole("table", { name: t.invitations.pending });
  const row = pending.getByRole("row").filter({ hasText: guest });
  await expect(row.getByRole("cell")).toHaveText([guest, t.companies.roles.employee, "Ana Souza", /\S/, /.*/]);
  await evidence("pending-invitation");

  // The email names the Company and who invited, with the link.
  const invitation = await mailbox.latest(guest, {
    subject: format(t.emails.invitation.subject, { inviterName: "Ana Souza", companyName: "Acme" }),
  });
  expect(invitation.text).toContain("Acme");
  expect(invitation.text).toContain("Ana Souza");
  expect(linkIn(invitation.html, "/invitations/")).toMatch(/\/invitations\/[\w-]+$/);
});

test(
  "an invited visitor signs up through the link, verifies, signs in and lands on the Company",
  { tag: "@evidence" },
  async ({ page, baseURL, t, mailbox, evidence }) => {
    const owner = `owner-${randomUUID()}@example.com`;
    const guest = `guest-${randomUUID()}@example.com`;
    const password = "correct horse battery";

    // The Owner of Acme, through the API, invites the visitor's address as an Employee.
    const headers = { origin: baseURL! };
    expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { name: "Ana Souza", email: owner, password } })).ok()).toBe(true);
    const ownerVerification = await mailbox.latest(owner, { subject: t.emails.verifyEmail.subject });
    expect((await page.request.get(linkIn(ownerVerification.html, "/api/auth/verify-email"))).ok()).toBe(true);
    expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email: owner, password } })).ok()).toBe(true);
    const company = (await (await page.request.post("/api/companies", { headers, data: { name: "Acme" } })).json()) as { id: string };
    const invited = await page.request.post(`/api/companies/${company.id}/invitations`, { headers, data: { email: guest, role: "employee" } });
    expect(invited.status()).toBe(201);
    await page.context().clearCookies();

    // The visitor opens the link of the email: the Company and the role, before any account.
    const email = await mailbox.latest(guest, {
      subject: format(t.emails.invitation.subject, { inviterName: "Ana Souza", companyName: "Acme" }),
    });
    await page.goto(linkIn(email.html, "/invitations/"));
    await expect(page.getByRole("heading", { level: 1, name: format(t.invitations.accept.title, { companyName: "Acme" }) })).toBeVisible();
    await expect(page.getByTestId("invited-email")).toHaveText(format(t.invitations.accept.invitedEmail, { email: guest }));
    await evidence("invitation-link");

    // No account yet: they sign up, and verify the email.
    await page.getByRole("link", { name: t.invitations.accept.signUp }).click();
    await page.getByLabel(t.auth.signUp.name).fill("Bruno Lima");
    await page.getByLabel(t.auth.signUp.email).fill(guest);
    await page.getByLabel(t.auth.signUp.password).fill(password);
    await page.getByRole("button", { name: t.auth.signUp.submit }).click();
    await expect(page.getByRole("heading", { name: t.auth.checkEmail.title })).toBeVisible();
    const verification = await mailbox.latest(guest, { subject: t.emails.verifyEmail.subject });
    await page.goto(linkIn(verification.html, "/api/auth/verify-email"));
    await expect(page.getByRole("heading", { name: t.auth.emailVerified.title })).toBeVisible();

    // They sign in and are back on the Invitation, which they accept.
    await page.getByRole("link", { name: t.auth.emailVerified.signIn }).click();
    await page.getByLabel(t.auth.signIn.email).fill(guest);
    await page.getByLabel(t.auth.signIn.password).fill(password);
    await page.getByRole("button", { name: t.auth.signIn.submit }).click();
    await expect(page).toHaveURL(/\/invitations\/[\w-]+$/);
    await page.getByRole("button", { name: t.invitations.accept.submit }).click();

    // A Member of Acme, as an Employee, on the Company page.
    await expect(page.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/c/${company.id}$`));
    await expect(page.getByTestId("company-role")).toHaveText(format(t.companies.page.role, { role: t.companies.roles.employee }));
    await expect(page.getByRole("table", { name: t.companies.page.members }).getByRole("row").filter({ hasText: guest })).toBeVisible();
    await evidence("joined-company");
  },
);
