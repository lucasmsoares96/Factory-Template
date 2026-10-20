import { randomUUID } from "node:crypto";
import { expect, linkIn, test } from "../index.ts";

test(
  "a user who forgot their password resets it by email, signs in with the new one, and their other session ends",
  { tag: "@evidence" },
  async ({ page, browser, baseURL, t, mailbox, evidence }) => {
    const email = `forgetful-${randomUUID()}@example.com`;
    const oldPassword = "correct horse battery";
    const newPassword = "a brand new passphrase";

    // A verified user, already signed in on another device (another visitor IP).
    const signUp = await page.request.post("/api/auth/sign-up/email", {
      headers: { origin: baseURL! },
      data: { name: "Ana Souza", email, password: oldPassword, callbackURL: "/email-verified" },
    });
    expect(signUp.ok()).toBe(true);
    const verification = await mailbox.latest(email, { subject: t.emails.verifyEmail.subject });
    expect((await page.request.get(linkIn(verification.html, "/api/auth/verify-email"))).ok()).toBe(true);
    const otherDevice = await browser.newContext({
      baseURL,
      extraHTTPHeaders: { "cf-connecting-ip": `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 256)).join(".")}` },
    });
    const other = await otherDevice.newPage();
    await other.goto("/sign-in");
    await other.getByLabel(t.auth.signIn.email).fill(email);
    await other.getByLabel(t.auth.signIn.password).fill(oldPassword);
    await other.getByRole("button", { name: t.auth.signIn.submit }).click();
    await expect(other.getByTestId("user-name")).toHaveText("Ana Souza");

    await page.goto("/sign-in");
    await page.getByLabel(t.auth.signIn.email).fill(email);
    await page.getByRole("link", { name: t.auth.signIn.forgotPassword }).click();
    await expect(page.getByRole("heading", { name: t.auth.forgotPassword.title })).toBeVisible();
    await expect(page.getByLabel(t.auth.forgotPassword.email)).toHaveValue(email);
    await evidence("forgot-password");
    await page.getByRole("button", { name: t.auth.forgotPassword.submit }).click();
    await expect(page.getByRole("status")).toContainText(email);
    await evidence("reset-link-sent");

    const message = await mailbox.latest(email, { subject: t.emails.resetPassword.subject });
    await page.goto(linkIn(message.html, "/api/auth/reset-password/"));

    await expect(page).toHaveURL(/\/reset-password\?token=/);
    await expect(page.getByRole("heading", { name: t.auth.resetPassword.title })).toBeVisible();
    await page.getByLabel(t.auth.resetPassword.password).fill(newPassword);
    await evidence("reset-password");
    await page.getByRole("button", { name: t.auth.resetPassword.submit }).click();

    await expect(page.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(t.auth.signIn.passwordReset);
    await evidence("password-reset");
    await page.getByLabel(t.auth.signIn.email).fill(email);
    await page.getByLabel(t.auth.signIn.password).fill(oldPassword);
    await page.getByRole("button", { name: t.auth.signIn.submit }).click();
    await expect(page.getByRole("alert")).toHaveText(t.errors.INVALID_EMAIL_OR_PASSWORD);
    await page.getByLabel(t.auth.signIn.password).fill(newPassword);
    await page.getByRole("button", { name: t.auth.signIn.submit }).click();
    await expect(page.getByTestId("user-name")).toHaveText("Ana Souza");

    await other.reload();
    await expect(other).toHaveURL(/\/sign-in$/);
    await otherDevice.close();
  },
);
