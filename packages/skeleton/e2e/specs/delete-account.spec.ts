import { randomUUID } from "node:crypto";
import { format } from "../../src/i18n/index.ts";
import { expect, linkIn, test } from "../index.ts";

test(
  "deleting the account: refused while Owner, archived after deleting the Company, and signing in cancels it",
  { tag: "@evidence" },
  async ({ page, baseURL, t, mailbox, evidence }) => {
    const email = `leaver-${randomUUID()}@example.com`;
    const password = "correct horse battery";
    const remove = t.account.delete;

    // A verified user, signed in through the screen, Owner of one Company.
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

    // While Owner, the deletion is refused and names the Company, linked to its page.
    await page.getByRole("navigation", { name: t.nav.label }).getByRole("link", { name: t.account.nav }).click();
    await expect(page.getByRole("heading", { name: remove.title })).toBeVisible();
    await page.getByRole("button", { name: remove.start }).click();
    await page.getByLabel(remove.password).fill(password);
    await page.getByRole("button", { name: remove.submit }).click();
    const refusal = page.getByRole("alert");
    await expect(refusal.getByText(t.errors.OWNER_OF_COMPANIES)).toBeVisible();
    await expect(refusal.getByRole("link", { name: "Acme" })).toBeVisible();
    await evidence("delete-account-refused-owner");

    // The Owner deletes the Company from its page.
    await refusal.getByRole("link", { name: "Acme" }).click();
    await expect(page).toHaveURL(acmeUrl);
    await page.getByLabel(format(t.companies.settings.delete.confirm, { name: "Acme" })).fill("Acme");
    await page.getByRole("button", { name: t.companies.settings.delete.submit }).click();
    await expect(page.getByTestId("no-company")).toHaveText(t.home.noCompany);

    // A wrong password changes nothing.
    await page.getByRole("navigation", { name: t.nav.label }).getByRole("link", { name: t.account.nav }).click();
    await page.getByRole("button", { name: remove.start }).click();
    await page.getByLabel(remove.password).fill("not my password");
    await page.getByRole("button", { name: remove.submit }).click();
    await expect(page.getByRole("alert")).toHaveText(t.errors.INVALID_PASSWORD);

    // With the password, the account is archived and the user lands on the sign-in screen,
    // which says it goes for good in 30 days unless they sign in before.
    await page.getByLabel(remove.password).fill(password);
    await evidence("delete-account-confirmation");
    await page.getByRole("button", { name: remove.submit }).click();
    await expect(page.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(t.auth.signIn.accountDeleted);
    await evidence("account-archived");

    // The session is gone.
    await page.goto("/account");
    await expect(page).toHaveURL(/\/sign-in/);

    // Signing in within the 30 days cancels the deletion: the account is back.
    await page.getByLabel(t.auth.signIn.email).fill(email);
    await page.getByLabel(t.auth.signIn.password).fill(password);
    await page.getByRole("button", { name: t.auth.signIn.submit }).click();
    await expect(page.getByRole("heading", { name: remove.title })).toBeVisible();
    await evidence("account-deletion-canceled");
  },
);
