import { randomUUID } from "node:crypto";
import { expect, linkIn, test } from "../index.ts";

test(
  "a visitor signs up, verifies their email, signs in, sees their name and signs out",
  { tag: "@evidence" },
  async ({ page, t, mailbox, evidence }) => {
    const email = `visitor-${randomUUID()}@example.com`;
    const password = "correct horse battery";

    await page.goto("/sign-up");
    await page.getByLabel(t.auth.signUp.name).fill("Ana Souza");
    await page.getByLabel(t.auth.signUp.email).fill(email);
    await page.getByLabel(t.auth.signUp.password).fill(password);
    await evidence("sign-up");
    await page.getByRole("button", { name: t.auth.signUp.submit }).click();

    await expect(page.getByRole("heading", { name: t.auth.checkEmail.title })).toBeVisible();
    await evidence("check-email");

    const message = await mailbox.latest(email);
    expect(message.subject).toBe(t.emails.verifyEmail.subject);
    await page.goto(linkIn(message.html, "/api/auth/verify-email"));

    await expect(page).toHaveURL(/\/email-verified$/);
    await expect(page.getByRole("heading", { name: t.auth.emailVerified.title })).toBeVisible();
    await evidence("email-verified");
    await page.getByRole("link", { name: t.auth.emailVerified.signIn }).click();

    await page.getByLabel(t.auth.signIn.email).fill(email);
    await page.getByLabel(t.auth.signIn.password).fill(password);
    await page.getByRole("button", { name: t.auth.signIn.submit }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("user-name")).toHaveText("Ana Souza");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ana Souza");
    await evidence("home");

    await page.getByRole("button", { name: t.auth.signOut }).click();

    await expect(page.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(t.auth.signIn.signedOut);
    await evidence("signed-out");
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
  },
);
