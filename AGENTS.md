# Factory Template

A repository of Products plus the harness that builds them. A Product is an application built on the Skeleton; the Factory turns a ready issue into a reviewed pull request with evidence. Domain terms (Factory, Skeleton, Product, Stage, Escalation, ...) are defined in [GLOSSARY.md](GLOSSARY.md): use them as written.

## Map

- `packages/skeleton/`: the Skeleton, a shared package with the platform (Hono + OpenAPI, Better Auth, Postgres, MCP) and the base SPA. Read its `AGENTS.md` before editing there.
- `packages/skeleton/template/`: what `pnpm new-product` copies into `apps/<id>/`.
- `apps/<id>/`: one Product each (`apps/example` is the template's output). Read its `AGENTS.md` first.
- `.factory/`: the Factory harness (CLI, adapters, prompts, container image). Read its `AGENTS.md` first.
- `scripts/`: repo scripts (`dev`, `verify`, `ci-probe`).
- `docs/`: ADRs in `docs/adr/`, agent configuration in `docs/agents/` (issue tracker, labels, domain docs, MCP servers).
- `.agents/skills/`: agent skills (`.claude/skills/<name>` are symlinks to them). `skills-lock.json` pins the vendored ones.
- `.github/workflows/`: CI and Factory workflows.

## Commands

- `pnpm install`
- `pnpm dev [id]`: run a Product (the id is needed when there is more than one).
- `pnpm new-product <id>`: create `apps/<id>/` from the template.
- `pnpm generate`: regenerate the generated artifacts (OpenAPI client, MSW handlers, MCP tool snapshot, Worker types). Commit what it changes.
- `pnpm factory:verify`: generate, typecheck, lint, test and e2e. It must pass before you finish. Use `TURBO_FORCE=1` to bypass the Turbo cache.
- `pnpm --filter <package> run typecheck|lint|test|e2e`: one package.
- `pnpm factory <command>`: the Factory CLI (see `.factory/AGENTS.md`).

## Rules

- Write code, comments, commits, docs and PRs in English.
- Use Conventional Commits that reference the issue: `feat: add notes list #42`.
- Never create a `CLAUDE.md`. `AGENTS.md` files are the agent instructions.
- Do not edit `.github/workflows/`, `.agents/skills/`, `.claude/skills/`, `.claude/hooks/`, `skills-lock.json`, `.claude/settings.json` or `.mcp.json`. They change only by a human, and a diff there is refused.
- Never change a published migration (one that reached the base branch). Add a new one.
- Always check the current official documentation, for the version pinned in this repo, before you use a library, CLI or service API. Use the `cloudflare-docs` MCP server or WebFetch, never memory.
- Never run `pnpm bootstrap destroy`.
- Do not push, reset hard, clean, force-delete branches or switch branches: git hooks block these.
- Product code never edits `packages/skeleton/`. If the Skeleton lacks something, grow its interface in a separate change.
- Locate UI elements in tests by role plus the i18n key (`t.auth.signIn.title`) or `data-testid`, never by literal text.

## Building a product on the Skeleton

1. `pnpm new-product <id>` creates `apps/<id>/` (identity and texts in `product.config.ts`, theme in `src/client/styles.css`).
2. Add behaviour as a feature in `apps/<id>/src/features/<feature>/` and list it in `src/features/index.ts`. The `skeleton-add-feature` skill has the recipe.
3. A feature brings `schema.ts` (tables, picked up by glob), `routes/` (signed-in screens) and `public/` (visitor screens), `messages.ts` (spread into `product.config.ts`), and an `api(app)` that adds Hono + OpenAPI routes. Every operation becomes an MCP tool unless it sets `x-mcp: false`.
4. Database changes only add: `skeleton-add-migration`. Endpoints: `skeleton-add-endpoint`. Browser evidence: `skeleton-evidence-test`.
5. Imports are restricted by lint (`no-restricted-imports`): a Product imports the Skeleton only through its package exports.

## Agent skills

### Issue tracker

Issues live in the forge's issue tracker, via the `gh` CLI (or local Markdown files when run locally). See `docs/agents/issue-tracker.md`.

### Triage labels

The five triage labels plus the Factory labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Skills

Skills are in `.agents/skills/`. Matt Pocock's engineering skills (`tdd`, `code-review`, `triage`, `implement`, `diagnosing-bugs`, `codebase-design`, `domain-modeling`) are used by the Factory. The planning skills (`grilling`, `wayfinder`, `research`, `prototype`, `to-spec`, `to-tickets`, `wizard`, `pr`, `handoff`, `writing-for-agents`, `setup-matt-pocock-skills`) are for humans. Vendor skills: `playwright-cli`, `workers-best-practices`. Stack recipes: `skeleton-add-endpoint`, `skeleton-add-migration`, `skeleton-add-feature`, `skeleton-evidence-test`.
