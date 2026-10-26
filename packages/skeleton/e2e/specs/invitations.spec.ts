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
