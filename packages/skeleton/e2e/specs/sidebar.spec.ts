import { randomUUID } from "node:crypto";
import { expect, linkIn, test } from "../index.ts";

test(
  "a signed-in user navigates by the sidebar, collapses it to icons, and uses it as a panel on a phone",
  { tag: "@evidence" },
  async ({ page, baseURL, t, mailbox, evidence }) => {
    const email = `sidebar-${randomUUID()}@example.com`;
    const password = "correct horse battery";

    const signUp = await page.request.post("/api/auth/sign-up/email", {
      headers: { origin: baseURL! },
      data: { name: "Ana Souza", email, password, callbackURL: "/email-verified" },
    });
    expect(signUp.ok()).toBe(true);
    const verification = await mailbox.latest(email, { subject: t.emails.verifyEmail.subject });
    expect((await page.request.get(linkIn(verification.html, "/api/auth/verify-email"))).ok()).toBe(true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/sign-in");
    await page.getByLabel(t.auth.signIn.email).fill(email);
    await page.getByLabel(t.auth.signIn.password).fill(password);
    await page.getByRole("button", { name: t.auth.signIn.submit }).click();
    await expect(page.getByTestId("user-name")).toHaveText("Ana Souza");

    // A full reload would lose this marker: navigating by the sidebar must not reload.
    await page.evaluate(() => Object.assign(globalThis, { notReloaded: true }));
    const navigation = page.getByRole("navigation", { name: t.nav.label });
    const account = navigation.getByRole("link", { name: t.account.nav });
    await account.click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(account).toHaveAttribute("data-active");
    await expect(navigation.getByRole("link", { name: t.nav.home })).not.toHaveAttribute("data-active");
    expect(await page.evaluate(() => "notReloaded" in globalThis)).toBe(true);
    await evidence("sidebar-open");

    const sidebar = page.locator("[data-slot=sidebar]");
    await page.getByRole("button", { name: t.nav.toggle }).first().click();
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
    await expect(account).toBeVisible();
    await evidence("sidebar-collapsed");
    await page.keyboard.press("ControlOrMeta+b");
    await expect(sidebar).toHaveAttribute("data-state", "expanded");

    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: t.nav.toggle }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await evidence("sidebar-mobile");
    await page.getByRole("dialog").getByRole("button", { name: t.nav.userMenu }).click();
    await page.getByRole("button", { name: t.auth.signOut }).click();
    await expect(page.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  },
);
