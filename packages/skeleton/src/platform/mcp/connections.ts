import {
  AuthorizationError,
  CimdFetchError,
  getOAuthApi,
  OAuthProvider,
  type OAuthHelpers,
  type OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { Hono, type Context, type ExecutionContext } from "hono";
import { createMiddleware } from "hono/factory";
import type { Messages } from "../../i18n/index.ts";
import { MCP_CONNECTION, type McpConnection, type SkeletonBindings, type SkeletonEnv } from "../env.ts";
import { resolveIdentity } from "../identity.ts";
import { buildLocale } from "../locale.ts";
import { consentErrorPage, consentPage } from "./consent-page.ts";
import type { Feature } from "../feature.ts";
import { createMcpServer } from "./server.ts";
import { MCP_SCOPES, type McpTool } from "./tool.ts";

export const MCP_PATH = "/mcp";
export const AUTHORIZE_PATH = "/oauth/authorize";
const TOKEN_PATH = "/oauth/token";
const REGISTER_PATH = "/oauth/register";

/** The paths the OAuth provider answers itself: discovery, token, client registration and `/mcp`. */
const PROVIDER_PATHS = [
  MCP_PATH,
  TOKEN_PATH,
  REGISTER_PATH,
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/*",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/*",
];

/** The Workers execution context, as the provider takes it. */
type WorkerContext = Parameters<OAuthProvider<SkeletonBindings>["fetch"]>[2];
/** What the provider adds to it for `/mcp`: the props stored at consent and the verified token. */
type McpContext = { props: McpConnection; auth: { scope: string[] } };

export type McpBridgeOptions = {
  /** The Product's id: names the MCP server and the protected resource. */
  title: string;
  t: Messages;
  /** The generated tools (`mcp-tools.gen.json`). */
  tools: readonly McpTool[];
  /** The composed app the tools call into, in the Worker. */
  app: { request: Hono<SkeletonEnv>["request"] };
  /** The Product's features: those with `mcp(server)` add tools the OpenAPI document cannot describe. */
  features?: readonly Feature[];
};

/**
 * The OpenAPI → MCP bridge of one Product: one `/mcp` behind one OAuth
 * provider, its Connections (clients, grants, tokens) in the Product's `OAUTH_KV`.
 *
 * Every hostname the Worker answers on is its own protected resource
 * (`<origin>/mcp`, issuer `<origin>`), the way Better Auth's links use the
 * request's origin: production, a preview and `wrangler dev` each get tokens that
 * only they accept. On Workers the origin is a hostname routed to this Worker,
 * never a header the client chose.
 */
export function mcpBridge({ title, t, tools, app, features = [] }: McpBridgeOptions) {
  const optionsByOrigin = new Map<string, OAuthProviderOptions<SkeletonBindings>>();
  const providers = new Map<string, OAuthProvider<SkeletonBindings>>();

  const apiHandler = {
    // A request whose token the provider verified: tools/list and tools/call
    // within the token's scopes; each tool calls its route with the token's user.
    fetch(request: Request, env: SkeletonBindings, ctx: WorkerContext) {
      const { props, auth } = ctx as unknown as McpContext;
      const connection: McpConnection = { userId: props.userId };
      const origin = new URL(request.url).origin;
      const server = () =>
        createMcpServer({
          name: title,
          tools,
          features,
          scopes: auth.scope,
          origin,
          callRoute: async (route) =>
            app.request(route, undefined, { ...env, [MCP_CONNECTION]: connection }, ctx as unknown as ExecutionContext),
        });
      return createMcpHandler(server, { route: MCP_PATH, legacy: "stateless" }).fetch(request);
    },
  };

  function options(origin: string): OAuthProviderOptions<SkeletonBindings> {
    let cached = optionsByOrigin.get(origin);
    if (!cached) {
      cached = {
        apiRoute: MCP_PATH,
        apiHandler,
        // Never reached: only the provider's own paths are routed to it.
        defaultHandler: { fetch: () => new Response(null, { status: 404 }) },
        authorizeEndpoint: AUTHORIZE_PATH,
        tokenEndpoint: TOKEN_PATH,
        // DCR, for clients that do not support Client ID Metadata Documents yet.
        clientRegistrationEndpoint: REGISTER_PATH,
        // CIMD; needs the `global_fetch_strictly_public` compatibility flag.
        clientIdMetadataDocumentEnabled: true,
        scopesSupported: [...MCP_SCOPES],
        resourceMetadata: { resource: `${origin}${MCP_PATH}`, authorization_servers: [origin], resource_name: title },
        // The consent page offers `write` on top; clients ask for `read` first.
        requiredScopes: ["read"],
      };
      // A Worker answers on a handful of hostnames; the cap only bounds the cache.
      if (optionsByOrigin.size >= 16) optionsByOrigin.clear();
      optionsByOrigin.set(origin, cached);
    }
    return cached;
  }

  function provider(origin: string) {
    let provider = providers.get(origin);
    if (!provider) {
      provider = new OAuthProvider(options(origin));
      if (providers.size >= 16) providers.clear();
      providers.set(origin, provider);
    }
    return provider;
  }

  /** Gives `c.var.connections()`: the OAuth helpers for the request's origin. */
  const context = createMiddleware<SkeletonEnv>(async (c, next) => {
    let helpers: OAuthHelpers | undefined;
    c.set("connections", () => (helpers ??= getOAuthApi(options(new URL(c.req.url).origin), c.env)));
    await next();
  });

  const routes = new Hono<SkeletonEnv>();
  routes.use(AUTHORIZE_PATH, context);
  routes.get(AUTHORIZE_PATH, (c) => authorize(c, t));
  routes.post(AUTHORIZE_PATH, (c) => authorize(c, t));
  for (const path of PROVIDER_PATHS) {
    routes.all(path, (c) => provider(new URL(c.req.url).origin).fetch(c.req.raw, c.env, c.executionCtx as unknown as WorkerContext));
  }

  return { context, routes };
}

/**
 * `/oauth/authorize`: the signed-in user (Better Auth's session) consents and
 * picks `read` or `write`; a visitor signs in first and comes back here. The
 * token carries only the user's id.
 */
async function authorize(c: Context<SkeletonEnv>, t: Messages): Promise<Response> {
  const oauth = c.var.connections();
  const failed = (message: string, status: 400 | 401 = 400) =>
    c.html(consentErrorPage({ locale: buildLocale, t, message }), status);
  try {
    const identity = await resolveIdentity(c);
    if (c.req.method === "GET") {
      const request = await oauth.parseAuthRequest(c.req.raw);
      if (!identity) {
        const here = new URL(c.req.url);
        return c.redirect(`/sign-in?redirect=${encodeURIComponent(here.pathname + here.search)}`);
      }
      const details = await oauth.describeConsent(request);
      const consent = await oauth.beginConsent(request);
      copyHeaders(consent.headers, c);
      return c.html(consentPage({ locale: buildLocale, t, details, handle: consent.handle, user: identity.user }));
    }

    const form = await c.req.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      copyHeaders(denied.headers, c);
      return c.redirect(denied.redirectTo);
    }
    if (!identity) return failed(t.connect.signInAgain, 401);
    const scope = form.get("access") === "write" ? ["read", "write"] : ["read"];
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: grantUserId(identity.user.id),
      metadata: {},
      scope,
      props: { userId: identity.user.id } satisfies McpConnection,
    });
    copyHeaders(approved.headers, c);
    return c.redirect(redirectTo);
  } catch (error) {
    // Only a request whose client and redirect URI were verified goes back to the client.
    if (error instanceof AuthorizationError && error.redirectTo) return c.redirect(error.redirectTo);
    if (error instanceof AuthorizationError) return failed(`${error.description} ${t.connect.startAgain}`);
    if (error instanceof CimdFetchError) return failed(t.connect.startAgain);
    throw error;
  }
}

function copyHeaders(headers: Headers, c: Context) {
  for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
  for (const [name, value] of headers) {
    if (name.toLowerCase() !== "set-cookie" && name.toLowerCase() !== "location") c.header(name, value);
  }
}

/** Grants are listed by user id, which may not contain `:` in `workers-oauth-provider`. */
function grantUserId(userId: string) {
  return encodeURIComponent(userId);
}

/**
 * Revokes every MCP Connection of the user: its grants and their tokens. A
 * password reset calls it, so an agent connected before the reset loses access.
 */
export async function revokeConnections(c: Context<SkeletonEnv>, user: { id: string }): Promise<void> {
  const oauth = c.var.connections();
  const grantIds: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(grantUserId(user.id), { cursor });
    grantIds.push(...page.items.map((grant) => grant.id));
    cursor = page.cursor;
  } while (cursor);
  for (const id of grantIds) await oauth.revokeGrant(id, grantUserId(user.id));
}
