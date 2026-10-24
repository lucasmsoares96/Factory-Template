import { randomUUID } from "node:crypto";
import { format } from "../../src/i18n/index.ts";
import {
  AGENT_REDIRECT_URI,
  authorizationRequest,
  connectMcpClient,
  discover,
  exchangeCode,
  registerClient,
} from "../../src/node/mcp-agent.ts";
import { expect, linkIn, test } from "../index.ts";

test(
  "a user connects an AI agent and revokes it in Connections",
  { tag: "@evidence" },
  async ({ page, baseURL, t, mailbox, evidence }) => {
    const m = t.account.connections;
    const email = `revoker-${randomUUID()}@example.com`;
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

    // Before any agent, Connections says there is none.
    await page.goto("/account");
    await page.getByRole("link", { name: m.link }).click();
    await expect(page).toHaveURL(/\/account\/connections$/);
    await expect(page.getByText(m.empty)).toBeVisible();

    // An agent registers itself and the user consents to `write` on its link.
    const discovery = await discover(baseURL!);
    const request = authorizationRequest(discovery, await registerClient(discovery, "Test Agent"), "read write");
    await page.goto(request.url.href);
    await expect(page.getByLabel(t.connect.write)).toBeChecked();
    const callback = page.waitForRequest((sent) => sent.url().startsWith(AGENT_REDIRECT_URI));
    await page.getByRole("button", { name: t.connect.allow }).click();
    const tokens = await exchangeCode(discovery, request, (await callback).url());
    const client = await connectMcpClient(baseURL!, tokens.access_token);
    try {
      expect((await client.callTool({ name: "getMe", arguments: {} })).isError).toBeFalsy();
    } finally {
      await client.close();
    }

    // Connections lists the agent with its access.
    await page.goto("/account");
    await page.getByRole("link", { name: m.link }).click();
    await expect(page.getByRole("heading", { name: m.title })).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: "Test Agent" });
    await expect(row).toContainText(m.write);
    await evidence("connections");

    // Revoking asks first.
    await row.getByRole("button", { name: m.revoke }).click();
    const confirmation = page.getByRole("alertdialog", { name: format(m.confirmTitle, { app: "Test Agent" }) });
    await expect(confirmation).toBeVisible();
    await evidence("connection-revoke-confirm");
    await confirmation.getByRole("button", { name: m.confirm }).click();
    await expect(page.getByRole("status")).toHaveText(format(m.revoked, { app: "Test Agent" }));
    await expect(page.getByText(m.empty)).toBeVisible();
    await evidence("connection-revoked");

    // The agent's token no longer opens /mcp.
    const mcp = await page.request.post(new URL("/mcp", baseURL!).href, {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(mcp.status()).toBe(401);
  },
);
