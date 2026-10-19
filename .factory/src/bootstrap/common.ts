import type { Step, StepContext } from "./steps.ts";
import { labelSpecs } from "./labels.ts";

const TOKEN_SECRET = "CLOUDFLARE_API_TOKEN";
const ACCOUNT_SECRET = "CLOUDFLARE_ACCOUNT_ID";

/** The "Edit Cloudflare Workers" permissions as a token template URL (the token itself can only be made in the dashboard). */
export function cloudflareTokenUrl(): string {
  const permissions = [
    { key: "workers_scripts", type: "edit" },
    { key: "workers_kv_storage", type: "edit" },
    { key: "workers_r2", type: "edit" },
    { key: "account_settings", type: "read" },
  ];
  return `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=${encodeURIComponent(JSON.stringify(permissions))}&name=${encodeURIComponent("Factory Template (Edit Cloudflare Workers)")}`;
}

/** The token of this run: memory, then the environment. Never prompts. */
function knownToken(ctx: StepContext): string | undefined {
  return ctx.memory.cloudflareToken ?? (ctx.env.CLOUDFLARE_API_TOKEN || undefined);
}

async function accountId(ctx: StepContext, token: string): Promise<string> {
  if (ctx.memory.accountId) return ctx.memory.accountId;
  const accounts = await ctx.cloudflare(token).listAccounts();
  const first = accounts[0];
  if (!first) throw new Error("The Cloudflare token sees no account. Create it with the template URL and pick the account.");
  const id =
    accounts.length === 1
      ? first.id
      : await ctx.prompter.select({
          id: "cloudflare-account",
          message: "Which Cloudflare account?",
          options: accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.id})` })),
        });
  ctx.memory.accountId = id;
  return id;
}

export const cloudflareToken: Step = {
  id: "cloudflare-token",
  title: `Cloudflare token and account (${TOKEN_SECRET}, ${ACCOUNT_SECRET})`,
  async check(ctx) {
    const secrets = await ctx.github.listSecrets();
    return { done: secrets.includes(TOKEN_SECRET) && secrets.includes(ACCOUNT_SECRET) };
  },
  async run(ctx) {
    ctx.prompter.note(`Create the API token from the "Edit Cloudflare Workers" template:\n${cloudflareTokenUrl()}`);
    const token = (await ctx.prompter.password({ id: "cloudflare-token", message: "Paste the Cloudflare API token" })).trim();
    ctx.memory.cloudflareToken = token;
    delete ctx.memory.accountId;
    const id = await accountId(ctx, token); // also proves the token works, before anything is stored
    await ctx.github.setSecret(TOKEN_SECRET, token);
    await ctx.github.setSecret(ACCOUNT_SECRET, id);
  },
};

export const workersDev: Step = {
  id: "workers-dev",
  title: "workers.dev subdomain",
  async check(ctx) {
    const token = knownToken(ctx);
    if (!token) return { done: true, detail: "not verified: export CLOUDFLARE_API_TOKEN to check it" };
    const subdomain = await ctx.cloudflare(token).getWorkersSubdomain(await accountId(ctx, token));
    return { done: subdomain !== null, detail: subdomain ?? undefined };
  },
  async run(ctx) {
    const token = knownToken(ctx) ?? (await ctx.prompter.password({ id: "cloudflare-token", message: "Paste the Cloudflare API token (not stored)" })).trim();
    ctx.memory.cloudflareToken = token;
    const client = ctx.cloudflare(token);
    const id = await accountId(ctx, token);
    if ((await client.getWorkersSubdomain(id)) !== null) return;
    const subdomain = await ctx.prompter.text({ id: "workers-dev-subdomain", message: "Pick the workers.dev subdomain for the account" });
    await client.registerWorkersSubdomain(id, subdomain.trim());
  },
};

export const labels: Step = {
  id: "labels",
  title: "Labels from config.ts",
  async check(ctx) {
    const existing = new Map((await ctx.github.listLabels()).map((l) => [l.name, l]));
    const stale = labelSpecs(ctx.config).filter((want) => {
      const have = existing.get(want.name);
      return !have || have.color !== want.color || have.description !== want.description;
    });
    return { done: stale.length === 0, detail: stale.length ? `${stale.length} to create or update` : undefined };
  },
  async run(ctx) {
    for (const label of labelSpecs(ctx.config)) await ctx.github.upsertLabel(label);
  },
};

export const commonSteps: Step[] = [cloudflareToken, workersDev, labels];
