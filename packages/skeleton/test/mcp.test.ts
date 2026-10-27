import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, expect, test } from "vitest";
import { linkIn } from "../src/node/email-link.ts";
import {
  AGENT_REDIRECT_URI,
  authorizationRequest,
  connectMcpClient,
  discover,
  exchangeCode,
  registerClient,
  type AuthorizationRequest,
  type Discovery,
} from "../src/node/mcp-agent.ts";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend, type SentEmail } from "../src/node/resend-mock.ts";
import type { McpTool } from "../src/platform/mcp/tool.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 3: an agent connects to the test composition's `/mcp` the way an MCP
// client does (discovery, registration, consent, code exchange) and uses the
// tools through the SDK's client. The composition's tools: getMe, getNote,
// getCompanyNote, listConnections and the Companies' and Invitations' reads (read),
// createNote, revokeConnection, updateMe, createCompany, renameCompany, the
// Invitations' writes and inviteFromNotes (write); deleteCompany and
// transferOwnership are `x-mcp: false`.

/** A client that publishes its metadata (CIMD) instead of registering. */
const CIMD_CLIENT_ID = "https://agent.example.com/oauth/client.json";

const sent: SentEmail[] = [];
const resend = mockResend((email) => sent.push(email));
resend.use(
  http.get(CIMD_CLIENT_ID, () =>
    HttpResponse.json({
      client_id: CIMD_CLIENT_ID,
      client_name: "Published Agent",
      redirect_uris: [AGENT_REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  ),
);
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
let testAuth: Awaited<ReturnType<typeof createTestAuth>>;
let discovery: Discovery;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url });
  testAuth = await createTestAuth({ databaseUrl: db.url, baseURL: worker.origin });
  discovery = await discover(worker.origin);
});
afterAll(async () => {
  await testAuth?.close();
  await worker?.close();
  resend.close();
  await db?.drop();
});

async function signedInUser(name = "Ana Souza") {
  const user = await testAuth.saveUser(
    testAuth.createUser({ name, email: `user-${randomUUID()}@example.com`, emailVerified: true }),
  );
  const headers = await testAuth.getAuthHeaders({ userId: user.id });
  return { user, cookie: headers.get("cookie")! };
}

const cookiesOf = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]!);

/** Opens the consent page as the signed-in user and submits it: answers the page and where it redirects. */
async function consent(
  request: AuthorizationRequest,
  cookie: string,
  { decision = "approve", access = "read" }: { decision?: "approve" | "deny"; access?: "read" | "write" } = {},
) {
  const page = await fetch(request.url, { headers: { cookie }, redirect: "manual" });
  expect(page.status).toBe(200);
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)![1]!;
  const answer = await fetch(request.url, {
    method: "POST",
    headers: { cookie: [cookie, ...cookiesOf(page)].join("; "), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ handle, decision, access }),
    redirect: "manual",
  });
  expect(answer.status).toBe(302);
  return { html, redirect: answer.headers.get("location")! };
}

/** A user connects a freshly registered agent with `access`: answers the agent's token and SDK client. */
async function connectAgent(cookie: string, { access = "read", modern = false }: { access?: "read" | "write"; modern?: boolean } = {}) {
  const clientId = await registerClient(discovery);
  const request = authorizationRequest(discovery, clientId, access === "write" ? "read write" : "read");
  const { redirect } = await consent(request, cookie, { access });
  const tokens = await exchangeCode(discovery, request, redirect);
  const client = await connectMcpClient(worker.origin, tokens.access_token, { modern });
  return { clientId, tokens, client };
}

/** The tool the test composition's feature registers by hand (`mcp(server)`); it is not in the generated list. */
const MANUAL_TOOL = "manualPing";
const names = (tools: { name: string }[]) => tools.map((tool) => tool.name);
/** What a `read` Connection sees: the GET operations, and the hand-registered tool. */
const READ_TOOLS = [
  "getCompany",
  "getCompanyNote",
  "getLastCompany",
  "getMe",
  "getNote",
  "listCompanies",
  "listConnections",
  "listInvitations",
  "listMembers",
  "manualPing",
];

test("without a token, /mcp answers 401 with a challenge that leads to the authorization server", async () => {
  expect(discovery.challenge).toMatch(/^Bearer /);
  expect(discovery.challenge).toContain(`resource_metadata="${worker.origin}/.well-known/oauth-protected-resource/mcp"`);
  expect(discovery.challenge).toContain(`scope="read"`);
  expect(discovery.resource).toBe(`${worker.origin}/mcp`);
  expect(discovery.issuer).toBe(worker.origin);
  expect(discovery.metadata).toMatchObject({
    authorization_endpoint: `${worker.origin}/oauth/authorize`,
    token_endpoint: `${worker.origin}/oauth/token`,
    registration_endpoint: `${worker.origin}/oauth/register`,
    client_id_metadata_document_supported: true,
    scopes_supported: ["read", "write"],
  });
});

test("a `read` Connection calls getMe as the user who consented, and never sees a write tool", async () => {
  const { user, cookie } = await signedInUser();
  const { tokens, client } = await connectAgent(cookie, { access: "read" });

  expect(tokens.scope).toBe("read");
  expect(names((await client.listTools()).tools)).toEqual(READ_TOOLS);
  const result = await client.callTool({ name: "getMe", arguments: {} });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toEqual({ id: user.id, name: "Ana Souza", email: user.email });
  await expect(client.callTool({ name: "createNote", arguments: { body: { text: "Hi" } } })).rejects.toThrow(
    "Tool createNote not found",
  );
  await expect(client.callTool({ name: "updateMe", arguments: { body: { name: "Mallory" } } })).rejects.toThrow(
    "Tool updateMe not found",
  );
  await client.close();
});

test("a `write` Connection renames the user who consented with updateMe, and getMe answers the new name", async () => {
  const { user, cookie } = await signedInUser();
  const { client } = await connectAgent(cookie, { access: "write" });

  const renamed = await client.callTool({ name: "updateMe", arguments: { body: { name: " Ana Lima " } } });

  expect(renamed.isError).toBeFalsy();
  expect(renamed.structuredContent).toEqual({ id: user.id, name: "Ana Lima", email: user.email });
  expect((await client.callTool({ name: "getMe", arguments: {} })).structuredContent).toMatchObject({ name: "Ana Lima" });
  expect(await (await worker.fetch("/api/me", { headers: { cookie } })).json()).toMatchObject({ name: "Ana Lima" });
  const blank = await client.callTool({ name: "updateMe", arguments: { body: { name: "  " } } });
  expect(blank.isError).toBe(true);
  expect(blank.content).toEqual([{ type: "text", text: "VALIDATION_FAILED: The request is invalid." }]);
  await client.close();
});

test("a `write` Connection sees every tool and its writes reach the route as the user", async () => {
  const { user, cookie } = await signedInUser();
  const { tokens, client } = await connectAgent(cookie, { access: "write" });

  expect(tokens.scope.split(" ").sort()).toEqual(["read", "write"]);
  expect(names((await client.listTools()).tools)).toEqual([
    "cancelInvitation",
    "createCompany",
    "createInvitation",
    "createNote",
    "getCompany",
    "getCompanyNote",
    "getLastCompany",
    "getMe",
    "getNote",
    "inviteFromNotes",
    "listCompanies",
    "listConnections",
    "listInvitations",
    "listMembers",
    "renameCompany",
    "resendInvitation",
    "revokeConnection",
    "updateMe",
    "manualPing",
  ]);
  const result = await client.callTool({ name: "createNote", arguments: { body: { text: "Buy milk" } } });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toEqual({ id: expect.any(String), text: "Buy milk", authorId: user.id });
  await client.close();
});

test("a route's 4xx comes back as a tool error with the API's message; its parameters reach the route", async () => {
  const { user, cookie } = await signedInUser();
  const { client } = await connectAgent(cookie);

  const missing = await client.callTool({ name: "getNote", arguments: { id: "missing" } });
  expect(missing.isError).toBe(true);
  expect(missing.content).toEqual([{ type: "text", text: "NOT_FOUND: Not found." }]);
  const found = await client.callTool({ name: "getNote", arguments: { id: "welcome", shout: "yes" } });
  expect(found.structuredContent).toEqual({ id: "welcome", text: "WELCOME", authorId: user.id });
  await client.close();
});

test("an agent creates and lists Companies as the user, and a Company they are not a Member of is not found", async () => {
  const { cookie } = await signedInUser();
  const other = await signedInUser("Mallory");
  const { client } = await connectAgent(cookie, { access: "write" });
  const foreign = (await (
    await worker.post("/api/companies", { name: "Not yours" }, { cookie: other.cookie })
  ).json()) as { id: string };

  const created = await client.callTool({ name: "createCompany", arguments: { body: { name: "Acme" } } });
  expect(created.isError).toBeFalsy();
  const company = created.structuredContent as { id: string };
  expect(company).toMatchObject({ name: "Acme", role: "owner" });
  const listed = await client.callTool({ name: "listCompanies", arguments: {} });
  expect(listed.structuredContent).toEqual({ items: [company], nextCursor: null });
  const got = await client.callTool({ name: "getCompany", arguments: { companyId: company.id } });
  expect(got.structuredContent).toEqual(company);

  for (const name of ["getCompany", "listMembers", "getCompanyNote"]) {
    const result = await client.callTool({ name, arguments: { companyId: foreign.id } });
    expect(result.isError, name).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "NOT_FOUND: Not found." }]);
  }
  // An agent's reads never decide where the user lands in the app.
  const last = await worker.fetch("/api/me/last-company", { headers: { cookie } });
  expect((await last.json()) as { id: string }).toEqual(company);
  expect(
    await db.query(`SELECT last_used_at FROM skeleton.members WHERE company_id = '${company.id}'`),
  ).toEqual([{ last_used_at: null }]);
  await client.close();
});

test("an agent renames a Company for its Owner, an Employee's agent gets a tool error, and no agent can delete or transfer it", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = (await (await worker.post("/api/companies", { name: "Acme" }, { cookie: ana.cookie })).json()) as {
    id: string;
  };
  await db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${company.id}', '${bruno.user.id}', 'employee')`);
  const owners = await connectAgent(ana.cookie, { access: "write" });
  const employees = await connectAgent(bruno.cookie, { access: "write" });

  const renamed = await owners.client.callTool({ name: "renameCompany", arguments: { companyId: company.id, body: { name: "Acme Corp" } } });
  expect(renamed.isError).toBeFalsy();
  expect(renamed.structuredContent).toMatchObject({ id: company.id, name: "Acme Corp", role: "owner" });
  const refused = await employees.client.callTool({ name: "renameCompany", arguments: { companyId: company.id, body: { name: "Mine" } } });
  expect(refused.isError).toBe(true);
  expect(refused.content).toEqual([{ type: "text", text: "FORBIDDEN: Your role in this Company does not allow this." }]);
  expect(names((await owners.client.listTools()).tools)).not.toContain("deleteCompany");
  await expect(
    owners.client.callTool({ name: "deleteCompany", arguments: { companyId: company.id, body: { name: "Acme Corp" } } }),
  ).rejects.toThrow(/Tool deleteCompany not found/);
  expect(names((await owners.client.listTools()).tools)).not.toContain("transferOwnership");
  await expect(
    owners.client.callTool({
      name: "transferOwnership",
      arguments: { companyId: company.id, body: { userId: bruno.user.id, name: "Acme Corp" } },
    }),
  ).rejects.toThrow(/Tool transferOwnership not found/);

  // Deleted in the app, the Company is gone for every former Member's agent on the next call.
  const deleted = await worker.fetch(`/api/companies/${company.id}`, {
    method: "DELETE",
    headers: { cookie: ana.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Acme Corp" }),
  });
  expect(deleted.status).toBe(204);
  for (const { client } of [owners, employees]) {
    for (const name of ["getCompany", "listMembers", "getCompanyNote"]) {
      const result = await client.callTool({ name, arguments: { companyId: company.id } });
      expect(result.isError, name).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "NOT_FOUND: Not found." }]);
    }
    await client.close();
  }
});

test("an agent invites as the Owner, and an Employee's agent gets a tool error FORBIDDEN", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = (await (await worker.post("/api/companies", { name: "Acme" }, { cookie: ana.cookie })).json()) as { id: string };
  await db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${company.id}', '${bruno.user.id}', 'employee')`);
  const owner = await connectAgent(ana.cookie, { access: "write" });
  const employee = await connectAgent(bruno.cookie, { access: "write" });
  const email = `guest-${randomUUID()}@example.com`;

  const invited = await owner.client.callTool({ name: "createInvitation", arguments: { companyId: company.id, body: { email, role: "employee" } } });
  expect(invited.isError).toBeFalsy();
  expect(invited.structuredContent).toMatchObject({ email, role: "employee" });
  expect(sent.filter((message) => message.to.includes(email))).toHaveLength(1);
  const listed = await owner.client.callTool({ name: "listInvitations", arguments: { companyId: company.id } });
  expect(listed.structuredContent).toMatchObject({ items: [{ email }], nextCursor: null });

  for (const [name, args] of [
    ["listInvitations", { companyId: company.id }],
    ["createInvitation", { companyId: company.id, body: { email: `other-${email}`, role: "employee" } }],
  ] as const) {
    const refused = await employee.client.callTool({ name, arguments: args });
    expect(refused.isError, name).toBe(true);
    expect(refused.content).toEqual([{ type: "text", text: "FORBIDDEN: Your role in this Company does not allow this." }]);
  }
  await owner.client.close();
  await employee.client.close();
});

test("tools/list serves exactly the committed tool list (the snapshot `pnpm generate` keeps)", async () => {
  const { cookie } = await signedInUser();
  const { client } = await connectAgent(cookie, { access: "write" });
  const committed = JSON.parse(
    readFileSync(new URL("./worker/mcp-tools.gen.json", import.meta.url), "utf8"),
  ) as McpTool[];

  const { tools: listed } = await client.listTools();
  const tools = listed.filter((tool) => tool.name !== MANUAL_TOOL);

  expect(tools).toEqual(
    committed.map(({ name, title, description, inputSchema, outputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema,
      ...(outputSchema && { outputSchema }),
      annotations,
    })),
  );
  await client.close();
});

test("a feature's mcp hook adds a tool the OpenAPI document does not describe", async () => {
  const { cookie } = await signedInUser();
  const { client } = await connectAgent(cookie, { access: "read" });

  const result = await client.callTool({ name: MANUAL_TOOL, arguments: {} });

  expect(result.isError).toBeFalsy();
  expect(result.content).toEqual([{ type: "text", text: "pong" }]);
  await client.close();
});

test("a client on the 2026-07-28 protocol uses the same tools", async () => {
  const { user, cookie } = await signedInUser();
  const { client } = await connectAgent(cookie, { modern: true });

  expect(names((await client.listTools()).tools)).toEqual(READ_TOOLS);
  expect((await client.callTool({ name: "getMe", arguments: {} })).structuredContent).toMatchObject({ id: user.id });
  await client.close();
});

test("a visitor without a session is sent to sign in, and comes back to the consent page", async () => {
  const request = authorizationRequest(discovery, await registerClient(discovery));

  const response = await fetch(request.url, { redirect: "manual" });

  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location")!, worker.origin);
  expect(location.pathname).toBe("/sign-in");
  expect(location.searchParams.get("redirect")).toBe(`${request.url.pathname}${request.url.search}`);
});

test("the consent page names the app, where access goes and who is signed in; Deny tells the client", async () => {
  const { user, cookie } = await signedInUser("Bia <Lima>");
  const request = authorizationRequest(discovery, await registerClient(discovery, "Evil <script>alert(1)</script>"));

  const { html, redirect } = await consent(request, cookie, { decision: "deny" });

  expect(html).toContain("Connect Evil &#60;script&#62;alert(1)&#60;/script&#62; to Skeleton");
  expect(html).not.toContain("<script>");
  expect(html).toContain("registered itself");
  expect(html).toContain("<strong>127.0.0.1</strong>");
  expect(html).toContain(`Signed in as Bia &#60;Lima&#62; (${user.email})`);
  const callback = new URL(redirect);
  expect(`${callback.origin}${callback.pathname}`).toBe(AGENT_REDIRECT_URI);
  expect(callback.searchParams.get("error")).toBe("access_denied");
  expect(callback.searchParams.get("state")).toBe(request.state);
});

test("a client that publishes its metadata document (CIMD) connects without registering", async () => {
  const { user, cookie } = await signedInUser();
  const request = authorizationRequest(discovery, CIMD_CLIENT_ID);

  const { html, redirect } = await consent(request, cookie);
  const tokens = await exchangeCode(discovery, request, redirect);
  const client = await connectMcpClient(worker.origin, tokens.access_token);

  expect(html).toContain("Published Agent is published by <strong>agent.example.com</strong>");
  expect((await client.callTool({ name: "getMe", arguments: {} })).structuredContent).toMatchObject({ id: user.id });
  await client.close();
});

test("once the user is gone, the Connection's tool calls fail as unauthenticated", async () => {
  const { user, cookie } = await signedInUser();
  const { client } = await connectAgent(cookie);
  await db.query(`delete from skeleton.users where id = '${user.id}'`);

  const result = await client.callTool({ name: "getMe", arguments: {} });

  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: "text", text: "UNAUTHENTICATED: Sign in to continue." }]);
  await client.close();
});

/** What `/mcp` answers a `tools/list` sent with `accessToken`. */
function listWith(accessToken: string) {
  return fetch(new URL("/mcp", worker.origin), {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

/** The agent asks for a new access token with its refresh token. */
function refresh(clientId: string, refreshToken: string) {
  return fetch(discovery.metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  });
}

test("a password reset revokes every Connection of the user: access and refresh tokens", async () => {
  const { user, cookie } = await signedInUser();
  const agents = [await connectAgent(cookie), await connectAgent(cookie, { access: "write" })];
  const connections = [];
  for (const { clientId, tokens, client } of agents) {
    await client.close();
    expect((await listWith(tokens.access_token)).status).toBe(200);
    // Refreshing works before the reset (and rotates the refresh token).
    const refreshed = await refresh(clientId, tokens.refresh_token!);
    expect(refreshed.status).toBe(200);
    const { access_token, refresh_token } = (await refreshed.json()) as { access_token: string; refresh_token: string };
    connections.push({ clientId, accessToken: access_token, refreshToken: refresh_token });
  }

  await worker.post("/api/auth/request-password-reset", { email: user.email, redirectTo: "/reset-password" });
  await expect.poll(() => sent.some((email) => email.to.includes(user.email)), { timeout: 10_000 }).toBe(true);
  const link = linkIn(sent.find((email) => email.to.includes(user.email))!.html, "/api/auth/reset-password/");
  const token = new URL(link).pathname.split("/").pop()!;
  expect(await worker.grantsOf(user.id)).toHaveLength(2);
  const reset = await worker.post("/api/auth/reset-password", { token, newPassword: "a brand new passphrase" });
  expect(reset.status).toBe(200);

  expect(await worker.grantsOf(user.id)).toEqual([]);
  for (const { clientId, accessToken, refreshToken } of connections) {
    expect((await listWith(accessToken)).status).toBe(401);
    expect((await refresh(clientId, refreshToken)).status).toBe(400);
  }
});

test("a password change revokes every Connection of the user, and the session it was changed in carries on", async () => {
  const email = `user-${randomUUID()}@example.com`;
  await worker.post("/api/auth/sign-up/email", { name: "Ana Souza", email, password: "correct horse battery" });
  await expect.poll(() => sent.some((message) => message.to.includes(email)), { timeout: 10_000 }).toBe(true);
  const verify = new URL(linkIn(sent.find((message) => message.to.includes(email))!.html, "/api/auth/verify-email"));
  await worker.fetch(`${verify.pathname}${verify.search}`, { redirect: "manual" });
  const signIn = await worker.post("/api/auth/sign-in/email", { email, password: "correct horse battery" });
  const cookie = cookiesOf(signIn).join("; ");
  const { user } = (await signIn.json()) as { user: { id: string } };
  const { clientId, tokens, client } = await connectAgent(cookie, { access: "write" });
  await client.close();
  expect((await listWith(tokens.access_token)).status).toBe(200);
  expect(await worker.grantsOf(user.id)).toHaveLength(1);

  const change = await worker.post(
    "/api/auth/change-password",
    { currentPassword: "correct horse battery", newPassword: "a brand new passphrase" },
    { cookie },
  );
  expect(change.status).toBe(200);

  // The Connection is gone from the user's grants, and its tokens with it.
  expect(await worker.grantsOf(user.id)).toEqual([]);
  expect((await listWith(tokens.access_token)).status).toBe(401);
  // The grant is gone: its refresh token no longer gets a new access token.
  expect((await refresh(clientId, tokens.refresh_token!)).status).toBe(400);
  // A new Connection, from the session that changed the password, works.
  const again = await connectAgent(cookiesOf(change).join("; "));
  await again.client.close();
  expect((await listWith(again.tokens.access_token)).status).toBe(200);
});

test("deleting the account revokes every Connection of the user at once", async () => {
  const email = `user-${randomUUID()}@example.com`;
  await worker.post("/api/auth/sign-up/email", { name: "Ana Souza", email, password: "correct horse battery" });
  await expect.poll(() => sent.some((message) => message.to.includes(email)), { timeout: 10_000 }).toBe(true);
  const verify = new URL(linkIn(sent.find((message) => message.to.includes(email))!.html, "/api/auth/verify-email"));
  await worker.fetch(`${verify.pathname}${verify.search}`, { redirect: "manual" });
  const signIn = await worker.post("/api/auth/sign-in/email", { email, password: "correct horse battery" });
  const cookie = cookiesOf(signIn).join("; ");
  const { user } = (await signIn.json()) as { user: { id: string } };
  const agents = [await connectAgent(cookie), await connectAgent(cookie, { access: "write" })];
  for (const { tokens, client } of agents) {
    await client.close();
    expect((await listWith(tokens.access_token)).status).toBe(200);
  }

  const deletion = await worker.post("/api/auth/delete-user", { password: "correct horse battery" }, { cookie });
  expect(deletion.status).toBe(200);

  expect(await worker.grantsOf(user.id)).toEqual([]);
  for (const { clientId, tokens } of agents) {
    expect((await listWith(tokens.access_token)).status).toBe(401);
    expect((await refresh(clientId, tokens.refresh_token!)).status).toBe(400);
  }
});

test("a token issued for one Product's /mcp is rejected by another Product's /mcp (US73)", async () => {
  const otherDb = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: otherDb.url });
  const other = await startTestWorker({ databaseUrl: otherDb.url });
  try {
    const { cookie } = await signedInUser();
    const { tokens, client } = await connectAgent(cookie);
    await client.close();
    const call = (origin: string) =>
      fetch(new URL("/mcp", origin), {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });

    expect((await call(worker.origin)).status).toBe(200);
    expect((await call(other.origin)).status).toBe(401);
  } finally {
    await other.close();
    await otherDb.drop();
  }
});
