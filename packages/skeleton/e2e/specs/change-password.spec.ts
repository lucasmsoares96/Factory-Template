import { randomUUID } from "node:crypto";
import { expect, linkIn, test } from "../index.ts";

test(
  "a signed-in user changes their password on the account page and signs in with the new one, and their other session ends",
  { tag: "@evidence" },
  async ({ page, browser, baseURL, t, mailbox, evidence }) => {
    const email = `changer-${randomUUID()}@example.com`;
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
    for (const device of [other, page]) {
      await device.goto("/sign-in");
      await device.getByLabel(t.auth.signIn.email).fill(email);
      await device.getByLabel(t.auth.signIn.password).fill(oldPassword);
      await device.getByRole("button", { name: t.auth.signIn.submit }).click();
      await expect(device.getByTestId("user-name")).toHaveText("Ana Souza");
    }

    await page.getByRole("navigation", { name: t.nav.label }).getByRole("link", { name: t.account.nav }).click();
    await expect(page.getByRole("heading", { name: t.account.password.title })).toBeVisible();

    // A wrong current password changes nothing.
    await page.getByLabel(t.account.password.current).fill("not my password");
    await page.getByLabel(t.account.password.new).fill(newPassword);
    await page.getByRole("button", { name: t.account.password.submit }).click();
    await expect(page.getByRole("alert")).toHaveText(t.errors.INVALID_PASSWORD);

    await page.getByLabel(t.account.password.current).fill(oldPassword);
    await page.getByLabel(t.account.password.new).fill(newPassword);
    await evidence("change-password");
    await page.getByRole("button", { name: t.account.password.submit }).click();
    await expect(page.getByRole("status")).toHaveText(t.account.password.changed);
    await evidence("password-changed");

    // This browser stays signed in; the other device is signed out.
    await page.reload();
    await expect(page.getByTestId("user-name")).toHaveText("Ana Souza");
    await other.reload();
    await expect(other).toHaveURL(/\/sign-in$/);
    await otherDevice.close();

    await page.getByRole("button", { name: t.auth.signOut }).click();
    await expect(page.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
    await page.getByLabel(t.auth.signIn.email).fill(email);
    await page.getByLabel(t.auth.signIn.password).fill(oldPassword);
    await page.getByRole("button", { name: t.auth.signIn.submit }).click();
    await expect(page.getByRole("alert")).toHaveText(t.errors.INVALID_EMAIL_OR_PASSWORD);
    await page.getByLabel(t.auth.signIn.password).fill(newPassword);
    await page.getByRole("button", { name: t.auth.signIn.submit }).click();
    await expect(page.getByTestId("user-name")).toHaveText("Ana Souza");
    await evidence("signed-in-with-new-password");
  },
);
