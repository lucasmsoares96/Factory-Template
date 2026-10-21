import { configVariables } from "../config.ts";
import type { CloudflareClient, NeonClient, NeonProject, ResendClient } from "./clients.ts";
import { cloudflareHandle, productionEnvironment } from "./domain.ts";
import { FACTORY_ENABLED, FACTORY_MACHINE_USER, FACTORY_TOKEN } from "./factory.ts";
import { accountNames } from "./accounts.ts";
import { DEPLOY_PRODUCTS, MAIN_RULESET, USE_ENVIRONMENTS, neonHandle, neonOrgId, parseProductList, productionSecrets } from "./product.ts";
import { PREVIEWS_ENABLED, PREVIEW_PRODUCTS, previewEnvironment, previewNames, previewProjectName } from "./previews.ts";
import type { ProductIdentity, StepContext } from "./steps.ts";

/**
 * `pnpm bootstrap destroy`: takes down what the wizard made, after listing it and asking for the id. It never deletes the
 * repository, its issues, its labels, an account, a DNS record or the workers.dev subdomain. Only a person at a terminal can
 * run it: `CI` set or no terminal ends it before the first API call.
 */
export type DestroyScope =
  | { kind: "all" }
  | { kind: "product"; id: string }
  | { kind: "previews"; id: string }
  | { kind: "factory" }
  | { kind: "common" };

export const DESTROY_USAGE = `Usage: pnpm bootstrap destroy [product <id> | previews <id> | factory | common]
  (no argument)          everything: every Product, the Factory and the common part (type "all")
  product <id>           one Product: Worker, KV, Neon projects, Resend domain, secrets, variables, environments (production and previews)
  previews <id>          only the previews of one Product
  factory                the machine user, the Factory secrets and variables
  common                 the Cloudflare secrets of the common part`;

export function parseScope(positionals: string[]): DestroyScope | undefined {
  const [kind, id, ...rest] = positionals;
  if (rest.length > 0) return undefined;
  if (kind === undefined) return { kind: "all" };
  if ((kind === "factory" || kind === "common") && id === undefined) return { kind };
  if ((kind === "product" || kind === "previews") && id !== undefined && /^[a-z][a-z0-9-]*$/.test(id)) return { kind, id };
  return undefined;
}

/** Why this run may not go on, or undefined. Checked before anything is read. */
export function refusal(ctx: StepContext): string | undefined {
  if (ctx.env.CI) return "destroy refuses to run when CI is set: only a person at a terminal may delete these resources.";
  if (!ctx.interactive) return "destroy needs a terminal to ask for the confirmation, and there is none: only a person at a terminal may delete these resources.";
  return undefined;
}

type Group = "Cloudflare" | "Neon" | "Resend" | "GitHub";
const ORDER: Group[] = ["Cloudflare", "Neon", "Resend", "GitHub"];

interface Item {
  group: Group;
  text: string;
  /** The production database: shown apart from the rest. */
  highlight?: boolean;
  run: () => Promise<void>;
}

interface Plan {
  items: Item[];
  /** What could not be looked up or deleted safely; counts as a failure. */
  problems: string[];
  /** Things the person should know that are not failures. */
  notes: string[];
}

const KEPT = "Kept: the repository, its issues, its labels and the accounts (GitHub, Cloudflare, Neon, Resend); DNS records and the workers.dev subdomain are never touched.";

/** The one KV a Worker deploy makes for `OAUTH_KV` (wrangler's automatic name `<worker>-<binding>`, lower-case with dashes). */
const productionKvTitle = (id: string) => `${id}-oauth-kv`;
const previewKvTitle = (id: string) => `${id}-preview-oauth`;
const CLAUDE_SECRETS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];

interface Services {
  cloudflare?: { client: CloudflareClient; accountId: string };
  neon?: { client: NeonClient; projects: NeonProject[] };
  resend?: ResendClient;
}

async function guarded<T>(plan: Plan, what: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    plan.problems.push(`could not look up ${what}: ${(error as Error).message}`);
    return undefined;
  }
}

async function productIdentity(ctx: StepContext, id: string): Promise<ProductIdentity | undefined> {
  try {
    return await ctx.product(id);
  } catch {
    return undefined;
  }
}

/** The Products the repo knows: the two lists and the environments the wizard made. */
function knownProducts(variables: Record<string, string>, environments: string[]): string[] {
  const fromEnvs = environments.flatMap((name) => /^(.+)-(production|preview)$/.exec(name)?.[1] ?? []);
  return [...new Set([...parseProductList(variables[DEPLOY_PRODUCTS]), ...parseProductList(variables[PREVIEW_PRODUCTS]), ...fromEnvs])].sort();
}

/** Looks at the accounts and the repo and lists what the scope would delete. Nothing is changed here. */
export async function plan(ctx: StepContext, scope: DestroyScope): Promise<Plan> {
  const result: Plan = { items: [], problems: [], notes: [] };
  const { github } = ctx;
  const [secrets, variables, environments, rulesets] = await Promise.all([github.listSecrets(), github.listVariables(), github.listEnvironments(), github.listRulesets()]);

  const everything = scope.kind === "all";
  const productIds = everything ? knownProducts(variables, environments) : scope.kind === "product" || scope.kind === "previews" ? [scope.id] : [];
  const production = everything || scope.kind === "product";
  const previews = everything || scope.kind === "product" || scope.kind === "previews";

  const addGithub = (text: string, run: () => Promise<void>) => result.items.push({ group: "GitHub", text, run });
  const dropSecret = (name: string) => secrets.includes(name) && addGithub(`secret ${name}`, () => github.deleteSecret(name));
  const dropVariable = (name: string) => name in variables && addGithub(`variable ${name}`, () => github.deleteVariable(name));
  const environmentSecrets = new Map<string, string[]>();
  for (const name of environments) environmentSecrets.set(name, await github.listSecrets({ environment: name }).catch(() => []));
  const dropEnvironment = (name: string) => {
    if (!environments.includes(name)) return;
    const held = environmentSecrets.get(name) ?? [];
    addGithub(`environment ${name}${held.length > 0 ? `, with its secrets ${held.join(", ")}` : ""}`, () => github.deleteEnvironment(name));
  };

  // The accounts are only opened for a scope that has a Worker, a KV or a Neon project in it.
  const services: Services = {};
  if (productIds.length > 0) {
    services.cloudflare = await guarded(result, "Cloudflare (Workers and KV)", async () => {
      const handle = await cloudflareHandle(ctx, true);
      if (!handle) result.problems.push("no Cloudflare login on this machine: Workers and KV namespaces were not looked up.");
      return handle;
    });
    const neon = await guarded(result, "Neon", async () => {
      const client = await neonHandle(ctx, true);
      return client ? { client, projects: await client.listProjects(await neonOrgId(ctx, client)) } : undefined;
    });
    services.neon = neon;
  }

  // Resend: the key of the environment or memory; else one optional question, only when a Product has a Resend secret.
  if (production && productIds.length > 0) {
    let key = ctx.memory.resendKey ?? (ctx.env.RESEND_API_KEY || undefined);
    const hasResendSecret = () => productIds.some((id) => secrets.includes(productionSecrets(id).resendKey));
    const inEnvironment = async () => {
      for (const id of productIds) {
        if (environments.includes(productionEnvironment(id)) && (await github.listSecrets({ environment: productionEnvironment(id) })).includes(productionSecrets(id).resendKey)) return true;
      }
      return false;
    };
    if (!key && !ctx.memory.resendDeferred && (hasResendSecret() || (await inEnvironment()))) {
      key = (await ctx.prompter.password({ id: "resend-key", message: "Resend full-access key, to delete the sending domain too (optional: leave empty to skip; not stored)" })).trim() || undefined;
      if (!key) ctx.memory.resendDeferred = true;
    }
    if (key) {
      ctx.memory.resendKey = key;
      services.resend = ctx.resend(key);
    }
  }

  const sharedProductionLeft = parseProductList(variables[DEPLOY_PRODUCTS]).filter((id) => !productIds.includes(id));
  const sharedPreviewLeft = parseProductList(variables[PREVIEW_PRODUCTS]).filter((id) => !productIds.includes(id));

  for (const id of productIds) {
    if (production) await planProduction(ctx, result, services, id, { secrets, variables, dropSecret, dropVariable, dropEnvironment });
    if (previews) await planPreviews(ctx, result, services, id, { secrets, variables, dropSecret, dropVariable, dropEnvironment });
  }

  // The lists: this Product leaves them; an empty list goes with its switch, and the `main` ruleset with the last Product.
  if (production && productIds.length > 0 && parseProductList(variables[DEPLOY_PRODUCTS]).some((id) => productIds.includes(id))) {
    if (sharedProductionLeft.length > 0) addGithub(`variable ${DEPLOY_PRODUCTS}: remove ${productIds.join(", ")} (keeps ${sharedProductionLeft.join(", ")})`, () => github.setVariable(DEPLOY_PRODUCTS, sharedProductionLeft.join(",")));
    else {
      dropVariable(DEPLOY_PRODUCTS);
      dropVariable("DEPLOY_ENABLED");
    }
  }
  if (previews && productIds.length > 0 && parseProductList(variables[PREVIEW_PRODUCTS]).some((id) => productIds.includes(id))) {
    if (sharedPreviewLeft.length > 0) addGithub(`variable ${PREVIEW_PRODUCTS}: remove ${productIds.join(", ")} (keeps ${sharedPreviewLeft.join(", ")})`, () => github.setVariable(PREVIEW_PRODUCTS, sharedPreviewLeft.join(",")));
    else {
      dropVariable(PREVIEW_PRODUCTS);
      dropVariable(PREVIEWS_ENABLED);
    }
  }
  if (production && (everything || sharedProductionLeft.length === 0) && (everything || productIds.some((id) => parseProductList(variables[DEPLOY_PRODUCTS]).includes(id)))) {
    for (const ruleset of rulesets.filter((r) => r.name === MAIN_RULESET.name)) addGithub(`ruleset ${ruleset.name} on the default branch`, () => github.deleteRuleset(ruleset.id));
  }

  if (everything || scope.kind === "factory") {
    for (const name of [FACTORY_TOKEN, ...CLAUDE_SECRETS]) dropSecret(name);
    for (const name of new Set([FACTORY_MACHINE_USER, FACTORY_ENABLED, ...configVariables()])) dropVariable(name);
    const login = variables[FACTORY_MACHINE_USER];
    if (login) addGithub(`machine user ${login} as collaborator (or its pending invitation); its account stays`, () => github.removeCollaborator(login));
  }
  if (everything || scope.kind === "common") {
    for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) dropSecret(name);
    dropVariable(USE_ENVIRONMENTS);
  }

  result.items.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group));
  return result;
}

interface RepoState {
  secrets: string[];
  variables: Record<string, string>;
  dropSecret: (name: string) => unknown;
  dropVariable: (name: string) => unknown;
  dropEnvironment: (name: string) => unknown;
}

async function planProduction(ctx: StepContext, plan: Plan, services: Services, id: string, repo: RepoState): Promise<void> {
  const { client, accountId } = services.cloudflare ?? {};
  if (client && accountId) {
    const exists = await guarded(plan, `the Worker ${id}`, () => client.workerExists(accountId, id));
    if (exists) {
      plan.items.push({
        group: "Cloudflare",
        text: `Cloudflare Worker ${id}, with its Previews and Custom Domains`,
        run: async () => {
          await client.deleteWorkerDomains(accountId, id);
          await client.deleteWorker(accountId, id);
        },
      });
    }
    const kv = await guarded(plan, `the KV namespace ${productionKvTitle(id)}`, () => client.findKvNamespace(accountId, productionKvTitle(id)));
    if (kv) plan.items.push({ group: "Cloudflare", text: `KV namespace ${kv.title} (${kv.id})`, run: () => client.deleteKvNamespace(accountId, kv.id) });
  }

  if (services.neon) {
    const { client: neon } = services.neon;
    const matching = services.neon.projects.filter((p) => p.name === id);
    if (matching.length > 1) plan.problems.push(`${matching.length} Neon projects are named ${id} (${matching.map((p) => p.id).join(", ")}): none is deleted, delete the right one by hand.`);
    else if (matching[0]) {
      const project = matching[0];
      plan.items.push({
        group: "Neon",
        text: `PRODUCTION DATABASE: Neon project ${project.name} (${project.id}) with every branch, table and row in it`,
        highlight: true,
        run: () => neon.deleteProject(project.id),
      });
    }
  }

  const product = services.resend ? await productIdentity(ctx, id) : undefined;
  if (services.resend) {
    const resend = services.resend;
    if (!product?.domain) plan.problems.push(`the Resend domain of ${id} was not looked up: apps/${id}/product.config.ts is missing or has no domain.`);
    else {
      const domain = await guarded(plan, `the Resend domain ${product.domain}`, () => resend.findDomain(product.domain));
      if (domain) plan.items.push({ group: "Resend", text: `Resend domain ${domain.name}`, run: () => resend.deleteDomain(domain.id) });
    }
  } else if (ctx.memory.resendDeferred) {
    plan.notes.push(`the Resend domain of ${id} is not deleted (skipped: no Resend key). Delete it in the Resend dashboard if it exists.`);
  }

  const secretNames = Object.values(productionSecrets(id));
  const { password, email } = accountNames(id);
  repo.dropEnvironment(productionEnvironment(id));
  for (const name of [...secretNames, password]) repo.dropSecret(name);
  repo.dropVariable(email);
}

async function planPreviews(_ctx: StepContext, plan: Plan, services: Services, id: string, repo: RepoState): Promise<void> {
  const names = previewNames(id);
  const recordedProject = repo.variables[names.neonProject];
  const recordedKv = repo.variables[names.kv];
  const { client, accountId } = services.cloudflare ?? {};
  if (client && accountId) {
    const kv = recordedKv ? { id: recordedKv, title: previewKvTitle(id) } : await guarded(plan, `the KV namespace ${previewKvTitle(id)}`, () => client.findKvNamespace(accountId, previewKvTitle(id)));
    if (kv) plan.items.push({ group: "Cloudflare", text: `KV namespace ${kv.title} (${kv.id})`, run: () => client.deleteKvNamespace(accountId, kv.id) });
  }
  if (services.neon) {
    const { client: neon, projects } = services.neon;
    const matching = recordedProject ? projects.filter((p) => p.id === recordedProject) : projects.filter((p) => p.name === previewProjectName(id));
    if (matching.length > 1) plan.problems.push(`${matching.length} Neon projects are named ${previewProjectName(id)}: none is deleted, delete the right one by hand.`);
    else if (matching[0]) {
      const project = matching[0];
      plan.items.push({ group: "Neon", text: `Neon project ${project.name} (${project.id}) with the branches of every pull request`, run: () => neon.deleteProject(project.id) });
    }
  }
  repo.dropEnvironment(previewEnvironment(id));
  repo.dropSecret(names.neonKey);
  repo.dropVariable(names.neonProject);
  repo.dropVariable(names.kv);
}

/** What the person must type for this scope. */
export function confirmationWord(scope: DestroyScope): string {
  return scope.kind === "all" ? "all" : scope.kind === "factory" || scope.kind === "common" ? scope.kind : scope.id;
}

/** Entry point of `destroy`; returns the process exit code. */
export async function runDestroy(positionals: string[], ctx: StepContext): Promise<number> {
  const refused = refusal(ctx);
  if (refused) {
    ctx.log(refused);
    return 1;
  }
  const scope = parseScope(positionals);
  if (!scope) {
    ctx.log(DESTROY_USAGE);
    return 1;
  }

  const { items, problems, notes } = await plan(ctx, scope);
  if (items.length === 0 && problems.length === 0) {
    ctx.log("Nothing to delete for this scope: no resource of it was found.");
    ctx.log(KEPT);
    return 0;
  }

  ctx.log("\nThis will be deleted, for good:\n");
  for (const group of ORDER) {
    const rows = items.filter((i) => i.group === group);
    if (rows.length === 0) continue;
    ctx.log(`${group}:`);
    for (const row of rows) ctx.log(row.highlight ? `  !! ${row.text}` : `  - ${row.text}`);
  }
  for (const problem of problems) ctx.log(`Not listed: ${problem}`);
  for (const note of notes) ctx.log(`Note: ${note}`);
  ctx.log(`\n${KEPT}\n`);

  const word = confirmationWord(scope);
  const typed = (await ctx.prompter.text({ id: "destroy-confirm", message: `Type "${word}" to delete everything listed above` })).trim();
  if (typed !== word) {
    ctx.log(`"${typed}" is not "${word}". Nothing was deleted.`);
    return 1;
  }

  const failed: string[] = [];
  for (const item of items) {
    try {
      await item.run();
      ctx.log(`deleted ${item.text}`);
    } catch (error) {
      failed.push(item.text);
      ctx.log(`FAILED ${item.text}: ${(error as Error).message}`);
    }
  }
  ctx.log(`\n${items.length - failed.length} deleted, ${failed.length} failed${problems.length > 0 ? `, ${problems.length} not looked up` : ""}.`);
  if (failed.length > 0) ctx.log(`Failed, to do by hand or by running this command again:\n${failed.map((f) => `  - ${f}`).join("\n")}`);
  ctx.log(KEPT);
  return failed.length > 0 || problems.length > 0 ? 1 : 0;
}
