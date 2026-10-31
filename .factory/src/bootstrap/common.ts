import type { Step, StepContext } from "./steps.ts";
import { CloudflareRefused, type CloudflareClient } from "./clients.ts";
import { labelSpecs } from "./labels.ts";
import { variableName } from "../config.ts";
import { LANGUAGES, type Language } from "../messages.ts";

const TOKEN_SECRET = "CLOUDFLARE_API_TOKEN";
const ACCOUNT_SECRET = "CLOUDFLARE_ACCOUNT_ID";

/**
 * The token template URL (the token itself can only be made in the dashboard).
 * With an account id: the direct create page. Without: the documented account-picker redirect (`?to=/:account/api-tokens`;
 * `:account` is a literal placeholder Cloudflare resolves). Everything is percent-encoded exactly once.
 * Docs checked 2026-10-20: developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/ (updated 2025-01-14).
 */
export interface TokenPermission {
  key: string;
  type: "read" | "edit";
}

/**
 * The one token the wizard needs, in this order. Account permissions first, then the zone ones (the dashboard lists
 * `dns` and `zone` in zone sections). No `workers_routes`: attaching a Custom Domain (`PUT /accounts/{id}/workers/domains`)
 * accepts Workers Scripts Write only (API reference, read 2026-10-20).
 */
export const TOKEN_PERMISSIONS: TokenPermission[] = [
  { key: "workers_scripts", type: "edit" },
  { key: "workers_kv_storage", type: "edit" },
  { key: "account_settings", type: "read" },
  { key: "dns", type: "edit" },
  { key: "zone", type: "read" },
];

/** Said right before every token link: the form may render the permission dropdowns empty on first load (cloudflare-docs#29825). */
export const SUMMARY_HINT = "If a permission looks unchecked, continue to the summary page and check it there (the form may render empty on first load).";

export function cloudflareTokenUrl(accountId?: string, permissions: TokenPermission[] = TOKEN_PERMISSIONS): string {
  const query = `permissionGroupKeys=${encodeURIComponent(JSON.stringify(permissions))}&name=${encodeURIComponent("Factory Template (Edit Cloudflare Workers)")}`;
  return accountId
    ? `https://dash.cloudflare.com/${encodeURIComponent(accountId)}/api-tokens/create?${query}`
    : `https://dash.cloudflare.com/?to=/:account/api-tokens&${query}`;
}

/**
 * The Cloudflare credential of this machine, in this order: this run's memory, `CLOUDFLARE_API_TOKEN`, wrangler's saved
 * login. With `login` and no saved login, `wrangler login` runs once (browser; wrangler keeps it). Never prompts for a
 * token: the one that goes to the CI secret is collected by `cloudflare-token` alone. Held in memory, never logged or stored.
 */
export async function cloudflareCredential(ctx: StepContext, input: { login: boolean }): Promise<string | undefined> {
  const known = ctx.memory.cloudflareToken ?? (ctx.env.CLOUDFLARE_API_TOKEN || undefined);
  if (known) return (ctx.memory.cloudflareToken = known);
  let token = ctx.memory.noWranglerLogin ? undefined : await ctx.wrangler.savedToken();
  if (!token && input.login) {
    ctx.log("No saved Cloudflare login on this machine: wrangler opens your browser. wrangler keeps the login, so this happens once.");
    await ctx.wrangler.login();
    token = await ctx.wrangler.savedToken();
    if (!token) throw new Error("wrangler login finished but wrangler has no saved login. Run `pnpm --filter @factory/harness exec wrangler login` and try again.");
  }
  ctx.memory.noWranglerLogin = !token;
  if (token) ctx.memory.cloudflareToken = token;
  return token;
}

/**
 * The account of the credential: memory, `CLOUDFLARE_ACCOUNT_ID`, then the only account the credential sees (what
 * `wrangler whoami` lists). Never asks; with several accounts it says to set `CLOUDFLARE_ACCOUNT_ID`.
 */
export async function cloudflareAccountId(ctx: StepContext, token: string): Promise<string> {
  const known = ctx.memory.accountId ?? (ctx.env.CLOUDFLARE_ACCOUNT_ID || undefined);
  if (known) return (ctx.memory.accountId = known);
  const accounts = await ctx.cloudflare(token).listAccounts();
  const first = accounts[0];
  if (!first) throw new Error("The Cloudflare login sees no account.");
  if (accounts.length > 1) throw new Error(`The Cloudflare login sees ${accounts.length} accounts: export CLOUDFLARE_ACCOUNT_ID=<id> to pick one (ids: ${accounts.map((a) => a.id).join(", ")}).`);
  return (ctx.memory.accountId = first.id);
}

/** First collection of the token only (the CI secret does not exist yet): the account may be asked once here. */
async function askAccountId(ctx: StepContext, token: string): Promise<string> {
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

/** Read-only probes, one per permission. They cannot tell `edit` from `read`: the first real write (secret upload, DNS record) will. */
const PROBES: { permission: string; run: (client: CloudflareClient, accountId: string) => Promise<unknown> }[] = [
  { permission: "Workers Scripts", run: (c, id) => c.listWorkerScripts(id) },
  { permission: "Workers KV Storage", run: (c, id) => c.listKvNamespaces(id) },
  { permission: "Account Settings", run: (c, id) => c.getAccount(id) },
  { permission: "Zone", run: (c) => c.listZones() },
];

/** The permissions a freshly pasted token lacks, by read-only calls. A token that is invalid or inactive throws. */
export async function missingPermissions(client: CloudflareClient, accountId: string): Promise<string[]> {
  await client.verifyToken(accountId);
  const missing: string[] = [];
  for (const probe of PROBES) {
    try {
      await probe.run(client, accountId);
    } catch (error) {
      if (!(error instanceof CloudflareRefused)) throw error;
      missing.push(probe.permission);
    }
  }
  // DNS can only be read through a zone; an account with no zone has nothing to probe yet.
  if (!missing.includes("Zone")) {
    try {
      const [zone] = await client.listZones();
      if (zone) await client.listDnsRecords(zone.id);
    } catch (error) {
      if (!(error instanceof CloudflareRefused)) throw error;
      missing.push("DNS");
    }
  }
  return missing;
}

const ATTEMPTS = 3;

/**
 * The only prompt for the Cloudflare token, used by `cloudflare-token` when the CI secret does not exist. Asks (printing the template link first when `showLink`, always on a retry), checks it with read-only
 * calls and only then keeps it in memory. A token that lacks a permission is named, dropped and asked for again.
 */
export async function promptMainToken(ctx: StepContext, input: { message: string; showLink: boolean }): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    if (input.showLink || attempt > 1) {
      ctx.log(SUMMARY_HINT);
      ctx.prompter.link("Create the API token from this template:", cloudflareTokenUrl(ctx.env.CLOUDFLARE_ACCOUNT_ID || undefined));
    }
    const token = (await ctx.prompter.password({ id: "cloudflare-token", message: input.message })).trim();
    delete ctx.memory.accountId;
    let missing: string[];
    try {
      missing = await missingPermissions(ctx.cloudflare(token), await askAccountId(ctx, token));
    } catch (error) {
      if (!(error instanceof CloudflareRefused)) throw error;
      missing = ["Account Settings"]; // even listing the account was refused
    }
    if (missing.length === 0) {
      ctx.memory.cloudflareToken = token;
      return token;
    }
    delete ctx.memory.accountId;
    const names = missing.join(", ");
    if (attempt >= ATTEMPTS) throw new Error(`The Cloudflare token is still missing: ${names}. Nothing was stored.`);
    ctx.log(`The token is missing: ${names}. Check ${missing.length === 1 ? "it" : "them"} on the summary page of the link below, create the token again and paste the new one. Nothing was stored.`);
  }
}

export const cloudflareToken: Step = {
  id: "cloudflare-token",
  title: `Cloudflare token and account (${TOKEN_SECRET}, ${ACCOUNT_SECRET})`,
  asks: ["cloudflare-token"],
  // With the token secret in place the credential comes from the environment or wrangler and nothing is asked.
  async needs(ctx) {
    return !(await ctx.github.listSecrets()).includes(TOKEN_SECRET);
  },
  async check(ctx) {
    const secrets = await ctx.github.listSecrets();
    return { done: secrets.includes(TOKEN_SECRET) && secrets.includes(ACCOUNT_SECRET) };
  },
  async run(ctx) {
    // The token cannot be read back from the secret: once it exists the wizard never asks for it again (an explicit
    // `--redo cloudflare-token` is the person asking to replace it).
    const hasSecret = (await ctx.github.listSecrets()).includes(TOKEN_SECRET);
    if (!hasSecret || ctx.redo?.includes("cloudflare-token")) {
      const token = await promptMainToken(ctx, { message: "Paste the Cloudflare API token", showLink: true });
      await ctx.github.setSecret(TOKEN_SECRET, token);
      await ctx.github.setSecret(ACCOUNT_SECRET, await askAccountId(ctx, token));
      return;
    }
    const token = await cloudflareCredential(ctx, { login: true });
    if (!token) throw new Error("No Cloudflare login to read the account from.");
    await ctx.github.setSecret(ACCOUNT_SECRET, await cloudflareAccountId(ctx, token));
  },
};

export const workersDev: Step = {
  id: "workers-dev",
  title: "workers.dev subdomain",
  asks: ["workers-dev-subdomain"],
  // With no credential yet the token step is about to provide one (the subdomain is then unknown); with the secret in place the step is skipped.
  async needs(ctx) {
    if (!(await cloudflareCredential(ctx, { login: false }))) return !(await ctx.github.listSecrets()).includes(TOKEN_SECRET);
    return !(await workersDev.check(ctx)).done;
  },
  async check(ctx) {
    const token = await cloudflareCredential(ctx, { login: false });
    if (!token) return { done: true, detail: "not verified: no saved Cloudflare login (run `pnpm --filter @factory/harness exec wrangler login`)" };
    const subdomain = await ctx.cloudflare(token).getWorkersSubdomain(await cloudflareAccountId(ctx, token));
    return { done: subdomain !== null, detail: subdomain ?? undefined };
  },
  async run(ctx) {
    const token = (await cloudflareCredential(ctx, { login: true }))!;
    const client = ctx.cloudflare(token);
    const id = await cloudflareAccountId(ctx, token);
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

export const LANGUAGE_VARIABLE = variableName(["language"]);

const LANGUAGE_LABELS: Record<Language, string> = { en: "English (en)", "pt-BR": "Brazilian Portuguese (pt-BR)" };

/** The language of the Factory's public text. Asked only while the variable does not exist; `en` is offered first. */
export const language: Step = {
  id: "language",
  title: `Language of the Factory's public text (${LANGUAGE_VARIABLE})`,
  asks: ["factory-language"],
  async check(ctx) {
    const value = (await ctx.github.listVariables())[LANGUAGE_VARIABLE];
    return { done: value !== undefined, detail: value };
  },
  async run(ctx) {
    const value = await ctx.prompter.select<Language>({
      id: "factory-language",
      message: "Language of the text the Factory publishes (comments, pull requests, issues)? Code, commits and docs stay in English.",
      options: LANGUAGES.map((value) => ({ value, label: LANGUAGE_LABELS[value] })),
    });
    await ctx.github.setVariable(LANGUAGE_VARIABLE, value);
  },
};

export const commonSteps: Step[] = [cloudflareToken, workersDev, labels, language];
