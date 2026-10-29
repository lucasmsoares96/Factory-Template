import { randomUUID } from "node:crypto";
import { format } from "../../src/i18n/index.ts";
import { buyPlan, expect, linkIn, test } from "../index.ts";

test(
  "the Owner offers the ownership to a Member, who accepts it",
  { tag: "@evidence" },
  async ({ page, baseURL, t, mailbox, evidence }) => {
    const owner = `owner-${randomUUID()}@example.com`;
    const guest = `guest-${randomUUID()}@example.com`;
    const password = "correct horse battery";
    const headers = { origin: baseURL! };

    /** A verified account, signed in through the API. */
    async function signUpAndSignIn(name: string, email: string) {
      expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { name, email, password } })).ok()).toBe(true);
      const verification = await mailbox.latest(email, { subject: t.emails.verifyEmail.subject });
      expect((await page.request.get(linkIn(verification.html, "/api/auth/verify-email"))).ok()).toBe(true);
      expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password } })).ok()).toBe(true);
    }

    // Ana creates Acme and invites Bruno, who accepts the Invitation from its link.
    await signUpAndSignIn("Ana Souza", owner);
    await buyPlan(page.request, baseURL!);
    const company = (await (await page.request.post("/api/companies", { headers, data: { name: "Acme" } })).json()) as { id: string };
    const invited = await page.request.post(`/api/companies/${company.id}/invitations`, { headers, data: { email: guest, role: "employee" } });
    expect(invited.status()).toBe(201);
    await page.context().clearCookies();
    await signUpAndSignIn("Bruno Lima", guest);
    // Taking the Company over needs free Seats for its people.
    await buyPlan(page.request, baseURL!);
    const invitation = await mailbox.latest(guest, {
      subject: format(t.emails.invitation.subject, { inviterName: "Ana Souza", companyName: "Acme" }),
    });
    const token = linkIn(invitation.html, "/invitations/").split("/").pop()!;
    expect((await page.request.post(`/api/invitations/${token}/accept`, { headers })).ok()).toBe(true);
    // Kept for later: signing in again would hit the sign-in rate limit.
    const brunoCookies = await page.context().cookies();
    await page.context().clearCookies();

    // Ana, signed in through the screen, opens Acme and offers it to Bruno.
    await page.goto("/sign-in");
    await page.getByLabel(t.auth.signIn.email).fill(owner);
    await page.getByLabel(t.auth.signIn.password).fill(password);
    await page.getByRole("button", { name: t.auth.signIn.submit }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
    await expect(page.getByTestId("company-role")).toHaveText(format(t.companies.page.role, { role: t.companies.roles.owner }));
    await expect(page.getByRole("heading", { name: t.companies.settings.transfer.title })).toBeVisible();
    await page.getByLabel(t.companies.settings.transfer.recipient).selectOption({ label: format(t.companies.settings.transfer.member, { name: "Bruno Lima", email: guest }) });
    await page.getByLabel(format(t.companies.settings.transfer.confirm, { name: "Acme" })).fill("Acme");
    await evidence("offer-form");
    await page.getByRole("button", { name: t.companies.settings.transfer.submit }).click();

    // Nothing changed yet: Ana is still the Owner, with the offer pending, and Bruno got an email.
    await expect(page.getByTestId("ownership-offer-pending")).toBeVisible();
    await expect(page.getByTestId("company-role")).toHaveText(format(t.companies.page.role, { role: t.companies.roles.owner }));
    await evidence("offer-pending");
    await mailbox.latest(guest, { subject: format(t.emails.ownershipOffer.subject, { ownerName: "Ana Souza", companyName: "Acme" }) });
    const anaCookies = await page.context().cookies();

    // Bruno, in his own session, sees the offer on Acme and accepts it.
    await page.context().clearCookies();
    await page.context().addCookies(brunoCookies);
    await page.goto(`/c/${company.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
    await expect(page.getByTestId("company-role")).toHaveText(format(t.companies.page.role, { role: t.companies.roles.employee }));
    await expect(page.getByRole("heading", { name: t.ownershipOffer.title })).toBeVisible();
    await evidence("offer-received");
    await page.getByRole("button", { name: t.ownershipOffer.accept }).click();

    // Bruno is the Owner now and has the Owner's actions; Ana is an Employee.
    await expect(page.getByTestId("company-role")).toHaveText(format(t.companies.page.role, { role: t.companies.roles.owner }));
    const members = page.getByRole("table", { name: t.companies.page.members });
    await expect(members.getByRole("row", { name: `Ana Souza ${owner} ${t.companies.roles.employee}` })).toBeVisible();
    await expect(members.getByRole("row", { name: `Bruno Lima ${guest} ${t.companies.roles.owner}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: t.companies.settings.title })).toBeVisible();
    await expect(page.getByRole("heading", { name: t.invitations.title, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: t.ownershipOffer.title })).toBeHidden();
    await evidence("new-owner");

    // Ana, back in her session, is an Employee: the Owner's actions are gone from her page.
    await page.context().clearCookies();
    await page.context().addCookies(anaCookies);
    await page.goto(`/c/${company.id}`);
    await expect(page.getByTestId("company-role")).toHaveText(format(t.companies.page.role, { role: t.companies.roles.employee }));
    await expect(page.getByRole("heading", { name: t.companies.settings.title })).toBeHidden();
    await evidence("roles-after-transfer");
  },
);
