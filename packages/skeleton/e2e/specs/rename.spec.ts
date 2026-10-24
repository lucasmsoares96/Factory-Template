import { randomUUID } from "node:crypto";
import { expect, linkIn, test } from "../index.ts";

test(
  "a signed-in user opens the account page from the navigation and changes their name",
  { tag: "@evidence" },
  async ({ page, baseURL, t, mailbox, evidence }) => {
    const email = `renamer-${randomUUID()}@example.com`;
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
    await expect(page.getByTestId("user-name")).toHaveText("Ana Souza");

    const navigation = page.getByRole("navigation", { name: t.nav.label });
    await navigation.getByRole("link", { name: t.account.nav }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: t.account.title })).toBeVisible();
    await expect(page.getByLabel(t.account.name)).toHaveValue("Ana Souza");
    await evidence("account");

    await page.getByLabel(t.account.name).fill("   ");
    await page.getByRole("button", { name: t.account.submit }).click();
    await expect(page.getByRole("alert")).toHaveText(t.errors.VALIDATION_FAILED);
    await expect(page.getByTestId("user-name")).toHaveText("Ana Souza");

    // A full reload would lose this marker: the new name must arrive without one.
    await page.evaluate(() => Object.assign(globalThis, { notReloaded: true }));
    await page.getByLabel(t.account.name).fill("  Ana Lima  ");
    await page.getByRole("button", { name: t.account.submit }).click();
    await expect(page.getByRole("status")).toHaveText(t.account.saved);
    await expect(page.getByTestId("user-name")).toHaveText("Ana Lima");
    await expect(page.getByLabel(t.account.name)).toHaveValue("Ana Lima");
    await evidence("name-changed");

    await navigation.getByRole("link", { name: t.nav.home }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ana Lima");
    expect(await page.evaluate(() => (globalThis as { notReloaded?: boolean }).notReloaded)).toBe(true);
    await evidence("home-renamed");

    await page.reload();
    await expect(page.getByTestId("user-name")).toHaveText("Ana Lima");
  },
);
