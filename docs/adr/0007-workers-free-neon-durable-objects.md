# Cloudflare Workers Free, Neon Free and Durable Objects for hashing and rate limiting

The Skeleton must run at no cost (the Factory's Claude usage and an optional domain are the only exceptions). Each Product is one Worker with the SPA in Static Assets and Hono on `/api/*` and `/mcp`, no Pages. The database is Neon Postgres reached through `pg` and `drizzle-orm/node-postgres` directly on Neon's pooled URL, with no Hyperdrive (its free tier caps at 100k queries a day).

Sign-in is email and password. Better Auth hashes with scrypt, about 120 ms of CPU, which exceeds the Free plan's 10 ms request limit, so hashing runs in a stateless Durable Object, `PasswordHasher` (RPC `hash`/`verify`, a pool of 16 names, one retry on `.retryable`), plugged into `emailAndPassword.password.hash/verify`. The scrypt parameters are unchanged. The Better Auth rate limit is on, with `customStorage` in a `RateLimiter` Durable Object (SQLite) and `cf-connecting-ip` as the client address. Cloudflare's own Rate Limiting binding and KV are not used for this.

The MCP endpoint is `workers-oauth-provider` + `createMcpHandler` (`legacy: "stateless"`, CIMD and DCR on); the `McpAgent` class is deprecated. Tokens carry only the `userId`.

## Considered Options

- **A Paid plan, or passwordless sign-in**: rejected by the "free" rule.
- **Hashing in the Worker**: measured on another Free deployment, 65-179 ms of CPU per sign-in, with no 1102 in 30 days (largest 269 ms), so it would have worked in practice; the Durable Object keeps the cost off the request's budget and does not depend on that tolerance.
- **Hyperdrive**: its free query cap is lower than a Product needs.

## Consequences

- Measured in production, the Durable Object spends about 112 ms of CPU per hash (it ran up to 843 ms once) and about 0.7 ms per rate-limit call; the front Worker spends 0-1 ms. See `docs/measured-facts.md`.
- The Worker's own CPU p50 (21 ms) is above 10 ms already. No `exceededCpu` has been seen; see `docs/known-risks.md`.
- A Product's Durable Object classes and migrations live in its own Worker.
