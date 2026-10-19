import { randomUUID } from "node:crypto";
import { expect, linkIn, test } from "../index.ts";

test(
  "a visitor signs up and verifies their email from the link they receive",
  { tag: "@evidence" },
  async ({ page, t, mailbox, evidence }) => {
    const email = `visitor-${randomUUID()}@example.com`;

    await page.goto("/sign-up");
    await page.getByLabel(t.auth.signUp.name).fill("Ana Souza");
    await page.getByLabel(t.auth.signUp.email).fill(email);
    await page.getByLabel(t.auth.signUp.password).fill("correct horse battery");
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
  },
);
