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
  "a user connects an AI agent: signs in, consents to read only, and the agent calls getMe as them",
  { tag: "@evidence" },
  async ({ page, baseURL, t, mailbox, evidence }) => {
    // A verified account.
    const email = `agent-owner-${randomUUID()}@example.com`;
    const password = "correct horse battery";
    const signUp = await page.request.post("/api/auth/sign-up/email", {
      data: { name: "Ana Souza", email, password, callbackURL: "/email-verified" },
      headers: { origin: baseURL! },
    });
    expect(signUp.ok()).toBe(true);
    await page.request.get(linkIn((await mailbox.latest(email)).html, "/api/auth/verify-email"), { maxRedirects: 0 });

    // The agent finds the authorization server from /mcp's 401 and registers itself.
    const discovery = await discover(baseURL!);
    const request = authorizationRequest(discovery, await registerClient(discovery, "Test Agent"), "read write");

    // The user opens the agent's link, signs in, and lands on the consent page.
    await page.goto(request.url.href);
    await expect(page).toHaveURL(/\/sign-in\?redirect=/);
    await page.getByLabel(t.auth.signIn.email).fill(email);
    await page.getByLabel(t.auth.signIn.password).fill(password);
    await page.getByRole("button", { name: t.auth.signIn.submit }).click();

    await expect(page.getByRole("heading", { name: format(t.connect.title, { client: "Test Agent", appName: t.app.title }) })).toBeVisible();
    await expect(page.getByText(format(t.connect.signedInAs, { name: "Ana Souza", email }))).toBeVisible();
    await expect(page.getByLabel(t.connect.write)).toBeChecked();
    await page.getByLabel(t.connect.read).check();
    await evidence("mcp-consent");
    // The browser goes back to the agent's loopback callback (nothing listens there in the test).
    const callback = page.waitForRequest((request) => request.url().startsWith(AGENT_REDIRECT_URI));
    await page.getByRole("button", { name: t.connect.allow }).click();

    // The agent exchanges the code and calls a tool with the user's identity.
    const tokens = await exchangeCode(discovery, request, (await callback).url());
    expect(tokens.scope).toBe("read");
    const client = await connectMcpClient(baseURL!, tokens.access_token);
    try {
      const result = await client.callTool({ name: "getMe", arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ name: "Ana Souza", email });
    } finally {
      await client.close();
    }
  },
);
