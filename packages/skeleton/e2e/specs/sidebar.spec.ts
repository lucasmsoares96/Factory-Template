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

    // Two Companies, made through the API: the top of the sidebar shows the active one.
    let globexId = "";
    for (const name of ["Acme", "Globex"]) {
      const created = await page.request.post("/api/companies", { headers: { origin: baseURL! }, data: { name } });
      expect(created.ok()).toBe(true);
      globexId = ((await created.json()) as { id: string }).id;
    }
    await page.goto(`/c/${globexId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Globex" })).toBeVisible();
    const sidebar = page.locator("[data-slot=sidebar]");
    const companyButton = page.getByRole("button", { name: t.companies.switcher.label, exact: true });
    await expect(page.getByTestId("company-name")).toHaveText("Globex");
    await expect(page.getByTestId("company-role-label")).toHaveText(t.companies.roles.owner);
    await expect(page.getByTestId("user-email")).toHaveText(email);

    // A full reload would lose this marker: navigating by the sidebar must not reload.
    await page.evaluate(() => Object.assign(globalThis, { notReloaded: true }));
    await companyButton.click();
    await expect(page.getByRole("menuitem")).toHaveCount(3);
    await expect(page.getByRole("menuitem", { name: "Acme", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Globex", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: t.companies.switcher.new, exact: true })).toBeVisible();
    await expect(page.getByTestId("company-active")).toHaveCount(1);
    await evidence("sidebar-company-menu");
    await page.getByRole("menuitem", { name: "Acme" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
    await expect(page.getByTestId("company-name")).toHaveText("Acme");
    await companyButton.click();
    await page.getByRole("menuitem", { name: t.companies.switcher.new }).click();
    await expect(page).toHaveURL(/\/c\/new$/);

    // Nothing of the sidebar, closed or open, covers the page header or leaves the screen.
    const header = page.locator("header").first();
    const expectClear = async (menu = false) => {
      const viewport = page.viewportSize()!;
      const headerBox = await header.boundingBox();
      const inner = sidebar.locator("[data-slot=sidebar-inner]");
      const side = (await inner.count()) > 0 ? await inner.boundingBox() : null;
      expect(headerBox).not.toBeNull();
      if (side && side.width > 0 && viewport.width >= 768) {
        expect(headerBox!.x >= side.x + side.width - 1 || headerBox!.x + headerBox!.width <= side.x + 1).toBe(true);
      }
      if (menu) {
        const box = await page.locator("[data-slot=dropdown-menu-content][data-open]").boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
        const title = await header.getByText(t.app.title).boundingBox();
        const covers = !!title && box!.x < title.x + title.width && box!.x + box!.width > title.x && box!.y < title.y + title.height && box!.y + box!.height > title.y;
        expect(covers).toBe(false);
      }
    };
    await expectClear();
    await companyButton.click();
    await expectClear(true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: t.nav.userMenu }).click();
    await expectClear(true);
    await page.keyboard.press("Escape");

    const navigation = page.getByRole("navigation", { name: t.nav.label });
    await expect(navigation.getByRole("link", { name: t.account.nav })).toHaveCount(0);
    await page.getByRole("button", { name: t.nav.userMenu }).click();
    await expect(page.locator("[data-slot=dropdown-menu-content][data-open]")).toHaveCSS("opacity", "1");
    await expect(page.locator("[role=menuitem][href=\"/account/plan\"]")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: t.auth.signOut })).toBeVisible();
    await evidence("sidebar-user-menu");
    await page.getByRole("menuitem", { name: t.account.nav }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(navigation.getByRole("link", { name: t.nav.home })).not.toHaveAttribute("data-active");
    expect(await page.evaluate(() => "notReloaded" in globalThis)).toBe(true);
    await evidence("sidebar-open");

    await page.getByRole("button", { name: t.nav.toggle }).first().click();
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
    await evidence("sidebar-collapsed");
    await expectClear();
    await companyButton.click();
    await expect(page.getByRole("menuitem", { name: t.companies.switcher.new })).toBeVisible();
    await expectClear(true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: t.nav.userMenu }).click();
    await expect(page.getByRole("menuitem", { name: t.auth.signOut })).toBeVisible();
    await expectClear(true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+b");
    await expect(sidebar).toHaveAttribute("data-state", "expanded");

    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: t.nav.toggle }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: t.companies.switcher.label, exact: true }).click();
    await expectClear(true);
    await evidence("sidebar-mobile-company-menu");
    await page.keyboard.press("Escape");
    await evidence("sidebar-mobile");
    await page.getByRole("dialog").getByRole("button", { name: t.nav.userMenu }).click();
    await expectClear(true);
    await expect(page.locator("[data-slot=dropdown-menu-content][data-open]")).toHaveCSS("opacity", "1");
    await evidence("sidebar-mobile-user-menu");
    await page.getByRole("menuitem", { name: t.auth.signOut }).click();
    await expect(page.getByRole("heading", { name: t.auth.signIn.title })).toBeVisible();
  },
);
