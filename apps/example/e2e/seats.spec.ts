import { randomUUID } from "node:crypto";
import { buyPlan, expect, linkIn, test } from "@workspace/skeleton/e2e";
import { format } from "@workspace/skeleton/i18n";

test("the Owner on the free Plan is refused an Invitation, then buys a Plan and sees how many Seats are used", { tag: "@evidence" }, async ({ page, baseURL, t, mailbox, evidence }) => {
  const email = `owner-${randomUUID()}@example.com`;
  const guest = `guest-${randomUUID()}@example.com`;
  const password = "correct horse battery";
  const headers = { origin: baseURL! };

  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { name: "Ana Souza", email, password } })).ok()).toBe(true);
  const verification = await mailbox.latest(email, { subject: t.emails.verifyEmail.subject });
  expect((await page.request.get(linkIn(verification.html, "/api/auth/verify-email"))).ok()).toBe(true);
  expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password } })).ok()).toBe(true);
  const company = (await (await page.request.post("/api/companies", { headers, data: { name: "Acme" } })).json()) as { id: string };

  // The free Plan has one Seat, the Owner's: the Invitation is refused and says what to do.
  await page.goto(`/c/${company.id}`);
  await expect(page.getByTestId("company-seats-usage")).toHaveText(format(t.billing.seatsUsage, { used: "1", total: "1" }));
  await page.getByLabel(t.invitations.email).fill(guest);
  await page.getByLabel(t.invitations.role).selectOption("employee");
  await page.getByRole("button", { name: t.invitations.submit }).click();
  await expect(page.getByRole("alert")).toHaveText(t.errors.NO_FREE_SEAT);
  await evidence("invitation-refused");

  // With a Plan the Seats grow, the Invitation takes one, and Account › Plan lists the people.
  await buyPlan(page.request, baseURL!);
  await page.reload();
  await page.getByLabel(t.invitations.email).fill(guest);
  await page.getByLabel(t.invitations.role).selectOption("employee");
  await page.getByRole("button", { name: t.invitations.submit }).click();
  await expect(page.getByRole("status")).toHaveText(format(t.invitations.sent, { email: guest }));
  await expect(page.getByTestId("company-seats-usage")).toHaveText(format(t.billing.seatsUsage, { used: "2", total: "10" }));
  await evidence("seats-used");

  await page.getByRole("link", { name: t.billing.seatsManage }).click();
  const people = page.getByTestId(`seats-company-${company.id}`).getByTestId("seats-person");
  await expect(people).toHaveCount(2);
  await expect(people.filter({ hasText: guest })).toContainText(t.billing.person.invited);
  await evidence("seats-people");
});
