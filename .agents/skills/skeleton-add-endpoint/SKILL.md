---
name: skeleton-add-endpoint
description: Add an API endpoint (Hono + OpenAPI route, which also becomes an MCP tool) to a Product or to the Skeleton. Use when a feature needs a new route, a new MCP tool, or a change to an existing one.
---

# Add an endpoint

Routes are Hono `createRoute` definitions. The OpenAPI document is the single source: it generates the Kubb client, the MSW handlers and the MCP tools. Model every route on `packages/skeleton/src/features/me/api.ts`.

## Steps

1. Put the route in `apps/<id>/src/features/<feature>/api.ts` (or the Skeleton's feature). Export a router built with `createRouter()` and mount it in the feature's `api(app)` (`app.route("/", router)`).
2. Name the request and response Zod schemas with `.openapi("Name")` and give each field a `description` and an `example`.
3. Give the route `operationId` (camelCase, it becomes the hook `useX` and the MCP tool name), `summary` and `description` (the tool's description for the model). Missing descriptions fail a test.
4. Declare every response the route can answer, each error with a stable code from the Skeleton's error codes. Add `middleware: [requireIdentity] as const` when it acts for a user, and read the user from `c.var.identity`, never from a cookie or token.
5. Lists take `limit` (default 50) and a `cursor`, and answer a cursor for the next page.
6. A route that must not be an MCP tool sets `"x-mcp": false`. Writes need the `write` scope; reads must stay visible to `read` tokens.
7. Tool logic that cannot come from OpenAPI goes in the feature's `mcp(server)`: it is not scope-filtered, so check scope yourself.
8. Run `pnpm generate`. Commit the changed `src/mcp-tools.gen.json` (the tool snapshot) and any other committed generated file in the same commit.
9. Test it over HTTP first (test-first with `tdd`): a Worker test that sends requests and checks status, body and database rows, including each error response. Then the browser test or E2E if a screen uses it.
10. `pnpm factory:verify`.

## Do not

- Handwrite the client or the MSW handlers; they are generated.
- Mock the database.
- Expose Better Auth routes as tools.
