import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Messages } from "../i18n/index.ts";
import type { Auth } from "./auth.ts";
import type { Database } from "./db.ts";
import type { SendEmail } from "./email.ts";
import type { Feature } from "./feature.ts";
import type { Identity } from "./identity.ts";
import type { Member } from "./member.ts";
import type { PasswordHasherPool } from "./password.ts";
import type { RateLimiterPool } from "./rate-limit.ts";

/**
 * Where an MCP tool call puts the verified Connection's user: in the `env` of
 * the in-Worker request to the tool's route. A symbol, so no binding, header or
 * client can ever set it; only the `/mcp` handler does, after the token checks out.
 */
export const MCP_CONNECTION = Symbol("skeleton.mcp-connection");

/** What an MCP Connection's token carries: only the user. */
export type McpConnection = { userId: string };

/** Bindings every Product Worker provides to the Skeleton. */
export type SkeletonBindings = {
  /** Postgres connection string: Neon's pooled URL in production and previews, the container locally. */
  DATABASE_URL: string;
  /** Better Auth's signing and encryption secret. */
  BETTER_AUTH_SECRET: string;
  /** The `PasswordHasher` Durable Object (exported by the Product's Worker). */
  PASSWORD_HASHER: PasswordHasherPool;
  /** The `RateLimiter` Durable Object (exported by the Product's Worker): Better Auth's rate-limit counters. */
  RATE_LIMITER: RateLimiterPool;
  /** `outbox` in previews, `pnpm dev` and tests; unset (Resend) in production. */
  EMAIL_TRANSPORT?: string;
  /** `true` only in a preview (set by the deploy's preview config): enables `GET /api/preview/outbox`, with the outbox transport. */
  PREVIEW_OUTBOX?: string;
  /** Resend API key restricted to the Product's domain. Only production has it. */
  RESEND_API_KEY?: string;
  /** The Stripe secret key. Without it billing is off: no billing screen, no billing route. */
  STRIPE_SECRET_KEY?: string;
  /** The signing secret of the Stripe webhook endpoint (`/api/auth/stripe/webhook`). */
  STRIPE_WEBHOOK_SECRET?: string;
  /**
   * `true` only in `pnpm dev` and the tests: Stripe is the fake that runs in the Worker (`/api/fake-stripe`),
   * so billing needs no internet and no key. A Product declares it as a var (`"false"`) in its wrangler config
   * so that `pnpm dev` can set it. Never set where real money moves; a live key (`sk_live_`) turns it off.
   */
  STRIPE_FAKE?: string;
  /** The KV namespace where `workers-oauth-provider` keeps the MCP Connections (clients, grants, tokens). */
  OAUTH_KV: object;
  /** Set only on a tool's in-Worker route call (see `MCP_CONNECTION`). */
  [MCP_CONNECTION]?: McpConnection;
};

export type SkeletonEnv = {
  Bindings: SkeletonBindings;
  Variables: {
    db: Database;
    /** Runs `task` after the response; the request's database client outlives it. */
    defer: (task: Promise<unknown>) => void;
    /** The build locale's texts, with the Product's overrides: what emails say. */
    t: Messages;
    /** The email adapter: sends from the Product's `from`, through Resend or the outbox. */
    sendEmail: SendEmail;
    /** The request's Better Auth instance, built on first use. */
    auth: () => Auth;
    /** The Product's id (`product.config.ts`): billing tags its Stripe customers and Subscriptions with it. */
    productId: string;
    /** Who is calling: set by `requireIdentity` on the routes that need a user. */
    identity: Identity;
    /** The caller's membership in the Company of the path: set by `requireMember` on the Company routes. */
    member: Member;
    /** Every feature of the Product, in mount order (the Skeleton's first): their events run from the routes. */
    features: readonly Feature[];
    /** The OAuth helpers over the Product's MCP Connections, for this request's origin. */
    connections: () => OAuthHelpers;
  };
};
