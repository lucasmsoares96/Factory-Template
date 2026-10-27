import { randomUUID } from "node:crypto";
import { expect, linkIn, test } from "../index.ts";
import { format } from "../../src/i18n/index.ts";

test(
  "a signed-in user changes their email through the link sent to the new address",
  { tag: "@evidence" },
  async ({ page, baseURL, t, mailbox, evidence }) => {
    const email = `old-${randomUUID()}@example.com`;
    const newEmail = `new-${randomUUID()}@example.com`;
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

    await page.getByRole("navigation", { name: t.nav.label }).getByRole("link", { name: t.account.nav }).click();
    await expect(page.getByTestId("current-email")).toHaveText(format(t.account.currentEmail, { email }));

    await page.getByLabel(t.account.newEmail).fill(newEmail);
    await page.getByRole("button", { name: t.account.changeEmail }).click();
    await expect(page.getByTestId("email-pending")).toHaveText(
      format(t.account.emailPending, { email: newEmail, current: email }),
    );
    await expect(page.getByTestId("current-email")).toHaveText(format(t.account.currentEmail, { email }));
    await evidence("email-change-pending");

    // The link goes to the new address; opening it changes the account's email.
    const message = await mailbox.latest(newEmail, { subject: t.emails.changeEmail.subject });
    await page.goto(linkIn(message.html, "/api/auth/verify-email"));
    await expect(page).toHaveURL(/\/email-verified$/);

    await page.goto("/account");
    await expect(page.getByTestId("current-email")).toHaveText(format(t.account.currentEmail, { email: newEmail }));
    await expect(page.getByTestId("email-pending")).toHaveCount(0);
    await evidence("email-changed");

    // From now on the new email signs in, and the old one no longer does.
    const withOld = await page.request.post("/api/auth/sign-in/email", {
      headers: { origin: baseURL! },
      data: { email, password },
    });
    expect(withOld.status()).toBe(401);
    const withNew = await page.request.post("/api/auth/sign-in/email", {
      headers: { origin: baseURL! },
      data: { email: newEmail, password },
    });
    expect(withNew.ok()).toBe(true);
  },
);
