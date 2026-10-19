import { createHash, randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

/**
 * What an MCP client does against a Product, step by step over HTTP, for the
 * tests: discovery from the `401`, client registration (DCR), the authorization
 * request with PKCE, the code exchange, and a connected SDK `Client`. The
 * consent itself happens in between, in a browser or by posting the form.
 */

/** A loopback callback, as a local agent registers. Nothing listens on it: the test reads the redirect. */
export const AGENT_REDIRECT_URI = "http://127.0.0.1:33418/callback";

export type Discovery = {
  challenge: string;
  resource: string;
  issuer: string;
  metadata: {
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    scopes_supported: string[];
    client_id_metadata_document_supported?: boolean;
  };
};

/** Follows the `401` of an unauthenticated `/mcp` request to the authorization server's metadata. */
export async function discover(origin: string): Promise<Discovery> {
  const response = await fetch(new URL("/mcp", origin), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const challenge = response.headers.get("www-authenticate") ?? "";
  if (response.status !== 401) throw new Error(`/mcp answered ${response.status} without a token`);
  const resourceMetadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  if (!resourceMetadataUrl) throw new Error(`No resource_metadata in the challenge: ${challenge}`);
  const resourceMetadata = (await (await fetch(resourceMetadataUrl)).json()) as {
    resource: string;
    authorization_servers: string[];
  };
  const issuer = resourceMetadata.authorization_servers[0]!;
  const metadata = (await (await fetch(new URL("/.well-known/oauth-authorization-server", issuer))).json()) as Discovery["metadata"];
  return { challenge, resource: resourceMetadata.resource, issuer, metadata };
}

/** Registers a public client by DCR and answers its `client_id`. */
export async function registerClient(discovery: Discovery, clientName = "Test Agent"): Promise<string> {
  const response = await fetch(discovery.metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [AGENT_REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (response.status !== 201) throw new Error(`Registration failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { client_id: string }).client_id;
}

/** An authorization request with PKCE (S256): the URL to open, and what the code exchange needs. */
export function authorizationRequest(discovery: Discovery, clientId: string, scope = "read") {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("base64url");
  const url = new URL(discovery.metadata.authorization_endpoint);
  for (const [name, value] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: AGENT_REDIRECT_URI,
    scope,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: discovery.resource,
  })) {
    url.searchParams.set(name, value);
  }
  return { url, clientId, verifier, state };
}

export type AuthorizationRequest = ReturnType<typeof authorizationRequest>;

/** Exchanges the code the consent redirected with for the Connection's tokens. */
export async function exchangeCode(discovery: Discovery, request: AuthorizationRequest, redirect: string) {
  const callback = new URL(redirect);
  if (callback.searchParams.get("state") !== request.state) throw new Error(`Unexpected redirect: ${redirect}`);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error(`No code in the redirect: ${redirect}`);
  const response = await fetch(discovery.metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: AGENT_REDIRECT_URI,
      client_id: request.clientId,
      code_verifier: request.verifier,
      resource: discovery.resource,
    }),
  });
  if (!response.ok) throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as { access_token: string; refresh_token?: string; scope: string; token_type: string };
}

/**
 * An SDK client connected to `/mcp` with `accessToken`. `modern` negotiates the
 * 2026-07-28 protocol; otherwise it speaks 2025, like most clients today.
 */
export async function connectMcpClient(origin: string, accessToken: string, { modern = false } = {}) {
  const client = new Client(
    { name: "test-agent", version: "1.0.0" },
    modern ? { versionNegotiation: { mode: "auto" } } : {},
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", origin), { authProvider: { token: async () => accessToken } }),
  );
  return client;
}
