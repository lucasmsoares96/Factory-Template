# MCP servers

## Committed (`.mcp.json`)

Both need no secret, so they also work headless in the Factory.

| Server | Use | Source |
| --- | --- | --- |
| `cloudflare-docs` | Current Cloudflare documentation (Workers, D1, Durable Objects, Wrangler). Check it before using a Cloudflare API. | `https://docs.mcp.cloudflare.com/mcp` (Streamable HTTP, no auth) |
| `shadcn` | Browse and add shadcn components. The version is the one in the `pnpm-workspace.yaml` catalog. | `npx shadcn@<catalog version> mcp` |

## Personal, read-only (not committed)

These need your credentials, so they are never in `.mcp.json`. Add them to your own checkout with `--scope local` (stored in your user config, not in the repo).

```bash
# Cloudflare API: use an API token created with read-only permissions only.
claude mcp add --scope local --transport http cloudflare-api https://mcp.cloudflare.com/mcp \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN_READONLY"

# Neon: the server refuses writes with ?readonly=true. Sign in through OAuth when Claude Code asks.
claude mcp add --scope local --transport http neon "https://mcp.neon.tech/mcp?readonly=true"
```

The Factory never gets these servers. A pull request that changes `.mcp.json` is flagged as a sensitive change (ADR 0012).
