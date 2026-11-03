import { randomBytes } from "node:crypto";
import { withVerifyFull } from "../db-url.ts";
import type { NeonClient, NeonProject, RulesetInfo, RulesetSpec } from "./clients.ts";
import { passwordProblem } from "../../../packages/skeleton/src/platform/password-rules.ts";
import { accountNames } from "./accounts.ts";
import { previewNames } from "./previews.ts";
import { resendSteps, productionEnvironment, productSecretName, secretScope } from "./domain.ts";
import type { ProductIdentity, Step, StepContext } from "./steps.ts";

export const DEPLOY_PRODUCTS = "DEPLOY_PRODUCTS";
export const USE_ENVIRONMENTS = "FACTORY_USE_ENVIRONMENTS";

/** The names of the secrets the production deploy reads for a Product, all with the `<ID>_` prefix. */
export function productionSecrets(productId: string) {
  return {
    /** Direct connection: the migrations run against it. */
    databaseUrl: productSecretName(productId, "DATABASE_URL"),
    /** Pooled connection: the Worker's `DATABASE_URL`. */
    databaseUrlPooled: productSecretName(productId, "DATABASE_URL_POOLED"),
    /** The Worker's `BETTER_AUTH_SECRET`. */
    authSecret: productSecretName(productId, "BETTER_AUTH_SECRET"),
    /** The Worker's `RESEND_API_KEY`, made by `restricted-resend-key`; absent while the Resend domain is deferred. */
    resendKey: productSecretName(productId, "RESEND_API_KEY"),
  };
}

/** The per-Product variables of the database: the chosen region and the id of the production Neon project. */
export function databaseVariables(productId: string) {
  return {
    /** The Neon region of every database of the Product; fixed at creation, so changing it means `destroy db`. */
    region: productSecretName(productId, "REGION"),
    /** The id of the production Neon project (the previews' one is `previewNames(id).neonProject`). */
    neonProject: productSecretName(productId, "NEON_PROJECT_ID"),
  };
}

/** The region São Paulo, the default of the question. */
export const DEFAULT_REGION = "aws-sa-east-1";

/** `a, b c` and `a,b` both read as two ids. */
export function parseProductList(value: string | undefined): string[] {
  return (value ?? "").split(/[\s,]+/).filter(Boolean);
}

/**
 * The ruleset the wizard makes for the default branch: a pull request, no force-push, no deletion, the `verify` check,
 * which must have run against the newest default branch (`strict`: a green `verify` on an old base does not merge).
 */
export const MAIN_RULESET: RulesetSpec = {
  name: "main",
  include: ["~DEFAULT_BRANCH"],
  rules: ["deletion", "non_fast_forward", "pull_request", "required_status_checks"],
  requiredChecks: ["verify"],
  strict: true,
};

/**
 * Whether an existing ruleset already does what `MAIN_RULESET` asks for the default branch, whatever its name or id
 * (a hand-made one counts). Extra rules or settings do not matter; a missing rule or check does.
 */
export function coversMain(ruleset: RulesetInfo, defaultBranch: string): boolean {
  const refs = [...MAIN_RULESET.include, `refs/heads/${defaultBranch}`];
  return (
    ruleset.target === "branch" &&
    ruleset.enforcement === "active" &&
    ruleset.include.some((ref) => refs.includes(ref)) &&
    MAIN_RULESET.rules.every((rule) => ruleset.rules.includes(rule)) &&
    MAIN_RULESET.requiredChecks.every((check) => ruleset.requiredChecks.includes(check))
  );
}

/**
 * The Neon client of this run: the one in memory, else one built from `NEON_API_KEY` (non-interactive use, never stored),
 * else (when allowed) one that signs in through the browser. It is put in memory before the login so that the cleanup
 * of the command closes it even when the login fails.
 */
export async function neonHandle(ctx: StepContext, prompt: boolean): Promise<NeonClient | undefined> {
  if (ctx.memory.neon) return ctx.memory.neon;
  const apiKey = ctx.env.NEON_API_KEY || undefined;
  if (!apiKey && !prompt) return undefined;
  const client = ctx.neon({ apiKey });
  ctx.memory.neon = client;
  if (!apiKey) {
    // neonctl keeps its login: the browser opens only on the first run on this machine.
    await client.login();
  }
  return client;
}

/** The org to pass as `--org-id`: the only one, or the one the person picks. `undefined` when the account has none. */
export async function neonOrgId(ctx: StepContext, neon: NeonClient): Promise<string | undefined> {
  if (ctx.memory.neonOrg) return ctx.memory.neonOrg.id;
  const orgs = await neon.listOrgs();
  let id = orgs[0]?.id;
  if (orgs.length > 1) {
    id = await ctx.prompter.select({ id: "neon-org", message: "Which Neon organization holds the project?", options: orgs.map((o) => ({ value: o.id, label: `${o.name} (${o.id})` })) });
  }
  ctx.memory.neonOrg = { id };
  return id;
}

/**
 * The project of the org: the one with the recorded id when there is an id (`recordedId`, from the variable), else the
 * one named `name`. Names are not unique in Neon: with duplicates the person picks (or the check cannot say). A recorded
 * id whose project is gone is `null`: the project was deleted by hand.
 */
export async function findProject(ctx: StepContext, neon: NeonClient, name: string, prompt: boolean, purpose = "the production database", recordedId?: string): Promise<NeonProject | null | "ambiguous"> {
  const all = await neon.listProjects(await neonOrgId(ctx, neon));
  if (recordedId) return all.find((p) => p.id === recordedId) ?? null;
  const found = all.filter((p) => p.name === name);
  if (found.length <= 1) return found[0] ?? null;
  if (!prompt) return "ambiguous";
  const id = await ctx.prompter.select({
    id: "neon-project-pick",
    message: `${found.length} Neon projects are named ${name}. Which one is ${purpose}? (The wizard never deletes one.)`,
    options: found.map((p) => ({ value: p.id, label: p.id })),
  });
  return found.find((p) => p.id === id) ?? null;
}

/** The variable that records the id of a Product's Neon project (`production` or its `preview` one), if any. */
export async function recordedProjectId(ctx: StepContext, productId: string, kind: "production" | "preview"): Promise<string | undefined> {
  const variables = await ctx.github.listVariables();
  return variables[kind === "production" ? databaseVariables(productId).neonProject : previewNames(productId).neonProject] || undefined;
}

/** The region the Product chose (`<ID>_REGION`). */
export async function chosenRegion(ctx: StepContext, productId: string): Promise<string | undefined> {
  return (await ctx.github.listVariables())[databaseVariables(productId).region] || undefined;
}

/**
 * The Neon project of a Product, found by its recorded id (else by name) or made in the chosen region. A refusal from Neon
 * (a region it does not know) is shown with how to choose another; nothing is recorded then, so no half-made project stays.
 */
export async function ensureProject(ctx: StepContext, neon: NeonClient, productId: string, kind: "production" | "preview", name: string, purpose?: string): Promise<NeonProject> {
  const found = await findProject(ctx, neon, name, true, purpose, await recordedProjectId(ctx, productId, kind));
  const region = await chosenRegion(ctx, productId);
  if (found && found !== "ambiguous") {
    // A project in another region is never adopted (a project that reports no region is accepted): it would be recorded in silence.
    if (region && found.region && found.region !== region) {
      throw new Error(`The region of an existing database cannot change (${found.name} is in ${found.region}, chosen ${region}). Delete the databases with \`pnpm bootstrap destroy db ${productId}\`, then run this again.`);
    }
    return found;
  }
  if (!region) throw new Error(`No region chosen for ${productId}: run \`pnpm bootstrap ${kind === "production" ? "product" : "previews"} ${productId}\` (the region step asks it first).`);
  let made: NeonProject;
  try {
    made = await neon.createProject(name, region, await neonOrgId(ctx, neon));
  } catch (error) {
    throw new Error(`Neon refused to create ${name} in ${region}: ${(error as Error).message}\nNo project was made. Choose another region with \`pnpm bootstrap product ${productId} --redo region\` (NEON_REGION without a terminal).`);
  }
  ctx.log(`  created the Neon project ${made.name} in ${made.region ?? region}`);
  return made;
}

/**
 * The question of the region, asked once per Product before any Neon project is made (production or previews). The
 * answer is `<ID>_REGION`. A region cannot change after a project exists, so `--redo region` refuses when one does in
 * another region and points to `destroy db`.
 */
export function regionStep(product: ProductIdentity): Step {
  const { region: variable } = databaseVariables(product.id);
  return {
    id: "region",
    title: `Database region (${variable})`,
    asks: ["neon-region"],
    async check(ctx) {
      const chosen = await chosenRegion(ctx, product.id);
      return { done: chosen !== undefined, detail: chosen };
    },
    async run(ctx) {
      const region = (await ctx.prompter.text({ id: "neon-region", message: `Neon region of the databases of ${product.id} (it cannot change later; aws-sa-east-1 is São Paulo)`, initial: DEFAULT_REGION })).trim();
      if (!/^[a-z][a-z0-9-]*$/.test(region)) throw new Error(`"${region}" is not a Neon region id (like aws-sa-east-1).`);
      if (ctx.redo?.includes("region")) {
        const neon = await neonHandle(ctx, true);
        if (neon) {
          const wanted = [
            { name: product.id, id: await recordedProjectId(ctx, product.id, "production") },
            { name: `${product.id}-preview`, id: await recordedProjectId(ctx, product.id, "preview") },
          ];
          const projects = await neon.listProjects(await neonOrgId(ctx, neon));
          const elsewhere = projects.filter((p) => wanted.some((w) => (w.id ? p.id === w.id : p.name === w.name)) && p.region !== region);
          if (elsewhere.length > 0) {
            throw new Error(`The region of an existing database cannot change (${elsewhere.map((p) => `${p.name} is in ${p.region ?? "an unknown region"}`).join(", ")}). Delete the databases with \`pnpm bootstrap destroy db ${product.id}\`, then run this again.`);
          }
        }
      }
      await ctx.github.setVariable(variable, region);
    },
  };
}

/**
 * Secret names missing from the place the deploy reads them: the `production` environment, or the repo when there is
 * none. A copy left at repo level does not count while the environment exists: the deploy job would still work, but the
 * secret would be readable from any branch.
 */
export async function missingSecrets(ctx: StepContext, names: string[]): Promise<string[]> {
  const have = new Set(await ctx.github.listSecrets(await secretScope(ctx)));
  return names.filter((name) => !have.has(name));
}

async function recordProductionProject(ctx: StepContext, productId: string, projectId: string): Promise<void> {
  const name = databaseVariables(productId).neonProject;
  if ((await ctx.github.listVariables())[name] !== projectId) await ctx.github.setVariable(name, projectId);
}

export function neonProjectStep(product: ProductIdentity): Step {
  const { databaseUrl, databaseUrlPooled } = productionSecrets(product.id);
  return {
    id: "neon-project",
    title: `Neon project ${product.id}`,
    async check(ctx) {
      const neon = await neonHandle(ctx, false);
      if (!neon) {
        // Without a session the project cannot be looked up and secrets cannot be read back: their presence stands in for it.
        const missing = await missingSecrets(ctx, [databaseUrl, databaseUrlPooled]);
        return { done: missing.length === 0, detail: "not verified: set NEON_API_KEY to look it up" };
      }
      const found = await findProject(ctx, neon, product.id, false, undefined, await recordedProjectId(ctx, product.id, "production"));
      if (found === "ambiguous") return { done: false, detail: "several projects have this name" };
      return { done: found !== null, detail: found?.id };
    },
    async run(ctx) {
      const neon = await neonHandle(ctx, true);
      if (!neon) return;
      const project = await ensureProject(ctx, neon, product.id, "production", product.id);
      await recordProductionProject(ctx, product.id, project.id);
    },
  };
}

/**
 * Makes the environment `name` (only the default branch may deploy to it). `false` when the API refuses (the plan or
 * visibility of the repo): the repo-level fallback, `FACTORY_USE_ENVIRONMENTS=false`. One variable for both stage
 * environments: either both exist or the secrets of both are at repo level.
 */
export async function ensureEnvironment(ctx: StepContext, name: string): Promise<boolean> {
  const { defaultBranch } = await ctx.github.repo();
  if ((await ctx.github.upsertEnvironment(name, { branch: defaultBranch })) === "created") {
    // A rerun after an upgrade brings the environments back: the secrets in the repo keep working meanwhile.
    if ((await ctx.github.listVariables())[USE_ENVIRONMENTS] === "false") await ctx.github.setVariable(USE_ENVIRONMENTS, "true");
    return true;
  }
  if ((await ctx.github.listVariables())[USE_ENVIRONMENTS] !== "false") await ctx.github.setVariable(USE_ENVIRONMENTS, "false");
  ctx.log(`  GitHub refused the environment (the plan or visibility of the repo): the deploy secrets stay at repo level and ${USE_ENVIRONMENTS}=false. Run this step again after upgrading.`);
  return false;
}

/** The stage environment, one for the whole repository (shared by every Product), or the repo-level fallback. */
export function environmentStep(input: { id: string; name: string }): Step {
  const { name } = input;
  return {
    id: input.id,
    title: `GitHub environment ${name} (only main may deploy)`,
    async check(ctx) {
      return { done: (await ctx.github.listEnvironments()).includes(name) };
    },
    async run(ctx) {
      await ensureEnvironment(ctx, name);
    },
  };
}

export function githubEnvironmentStep(): Step {
  return environmentStep({ id: "github-environment", name: productionEnvironment() });
}

export function databaseSecretsStep(product: ProductIdentity): Step {
  const { databaseUrl, databaseUrlPooled } = productionSecrets(product.id);
  return {
    id: "database-secrets",
    title: `Database URLs (${databaseUrl}, ${databaseUrlPooled})`,
    async check(ctx) {
      return { done: (await missingSecrets(ctx, [databaseUrl, databaseUrlPooled])).length === 0 };
    },
    async run(ctx) {
      const neon = await neonHandle(ctx, true);
      if (!neon) return ctx.log("No Neon key: the database URLs were not stored. Export NEON_API_KEY or run again.");
      const project = await ensureProject(ctx, neon, product.id, "production", product.id);
      await recordProductionProject(ctx, product.id, project.id);
      const orgId = await neonOrgId(ctx, neon);
      const scope = await secretScope(ctx);
      // Each string goes from the CLI's stdout to the forge's stdin and is never held longer than this call.
      // The direct string also stays in memory for this run only: the account steps migrate and insert through it.
      ctx.memory.databaseUrl = withVerifyFull(await neon.connectionString(project.id, { pooled: false, orgId }));
      await ctx.github.setSecret(databaseUrl, ctx.memory.databaseUrl, scope);
      await ctx.github.setSecret(databaseUrlPooled, withVerifyFull(await neon.connectionString(project.id, { pooled: true, orgId })), scope);
    },
  };
}

/**
 * The direct connection string of the Product's production database, held in memory for the run: the one the Neon steps
 * already fetched, else asked of Neon (signing in unless `prompt` is false). `undefined` when Neon cannot be reached
 * or has no (single) project of that name. It is never logged, stored or sent to the forge from here.
 */
export async function productionDatabaseUrl(ctx: StepContext, product: ProductIdentity, prompt: boolean): Promise<string | undefined> {
  if (ctx.memory.databaseUrl) return ctx.memory.databaseUrl;
  const neon = await neonHandle(ctx, prompt);
  if (!neon) return undefined;
  const found = await findProject(ctx, neon, product.id, prompt, undefined, await recordedProjectId(ctx, product.id, "production"));
  if (!found || found === "ambiguous") return undefined;
  ctx.memory.databaseUrl = withVerifyFull(await neon.connectionString(found.id, { pooled: false, orgId: await neonOrgId(ctx, neon) }));
  return ctx.memory.databaseUrl;
}

async function requireDatabaseUrl(ctx: StepContext, product: ProductIdentity): Promise<string> {
  const url = await productionDatabaseUrl(ctx, product, true);
  if (!url) throw new Error(`No production database for ${product.id}: run the neon-project step first.`);
  return url;
}

/** Skeleton migrations, then the Product's, then the user: the tables exist before the first insert. */
async function createAccount(ctx: StepContext, url: string, product: ProductIdentity, user: { email: string; name: string; password: string }) {
  await ctx.accounts.migrate(url, product.id);
  return ctx.accounts.upsertUser(url, user);
}

const PASSWORD_ATTEMPTS = 3;

/** Asks twice (hidden) and applies the sign-up's password rules. The answer lives in the caller's frame only. */
export async function askPassword(ctx: StepContext, id: "default-account-password" | "preview-account-password", message = "Password of the default account (hidden; kept only as the deploy secret)"): Promise<string> {
  for (let attempt = 1; attempt <= PASSWORD_ATTEMPTS; attempt++) {
    const password = await ctx.prompter.password({ id, message });
    const problem = passwordProblem(password);
    if (problem) ctx.log(`  ${problem}`);
    else if ((await ctx.prompter.password({ id: `${id}-confirm`, message: "Type it again" })) === password) return password;
    else ctx.log("  The two passwords differ.");
  }
  throw new Error(`No valid password after ${PASSWORD_ATTEMPTS} tries.`);
}

/** The email the person types for the default account. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The Product's one account: the person's own, and the one the production smoke signs in as. The email and password are
 * typed by the person; the password goes only to the user row (hashed) and to the secret `<ID>_ACCOUNT_PASSWORD`.
 */
export function defaultAccountStep(product: ProductIdentity): Step {
  const { password: passwordName, email: emailName } = accountNames(product.id);
  return {
    id: "default-account",
    title: `Default account in the ${product.id} production database (${passwordName}, ${emailName}; the app and the smoke sign in as it)`,
    asks: ["default-account-email", "default-account-password", "default-account-password-confirm"],
    async check(ctx) {
      const email = (await ctx.github.listVariables())[emailName];
      if (!email || (await missingSecrets(ctx, [passwordName])).length > 0) return { done: false };
      // Presence stands in (secrets cannot be read back). The database confirms it only when this run already has a
      // Neon session, a key or the URL: the check never logs in, so a rerun with nothing to do never opens the browser.
      const url = await productionDatabaseUrl(ctx, product, false);
      return { done: url ? await ctx.accounts.verifiedUserExists(url, email) : true, detail: email };
    },
    async run(ctx) {
      const url = await requireDatabaseUrl(ctx, product);
      const email = (await ctx.prompter.text({ id: "default-account-email", message: "Email of the default account (created already verified)" })).trim().toLowerCase();
      if (!EMAIL.test(email)) throw new Error(`"${email}" is not an email.`);
      const redo = ctx.redo?.includes("default-account") === true;
      const exists = !redo && (await ctx.accounts.verifiedUserExists(url, email));
      const password = await askPassword(ctx, "default-account-password");
      if (exists) {
        // The user is there but the secret is not: the password just typed is stored as is, the user row is not touched.
        ctx.log(`  ${email} already exists: its password is stored as ${passwordName}, the user is left alone.`);
      } else {
        const result = await createAccount(ctx, url, product, { email, name: email.split("@")[0]!, password });
        ctx.log(result === "created" ? `  created ${email}` : `  reset the password of ${email}`);
      }
      await ctx.github.setSecret(passwordName, password, await secretScope(ctx));
      await ctx.github.setVariable(emailName, email);
    },
  };
}

export function authSecretStep(product: ProductIdentity): Step {
  const { authSecret } = productionSecrets(product.id);
  return {
    id: "auth-secret",
    title: `Better Auth secret (${authSecret})`,
    async check(ctx) {
      return { done: (await missingSecrets(ctx, [authSecret])).length === 0 };
    },
    async run(ctx) {
      // Secrets cannot be read back, so a redo makes a new one and every session signed with the old one ends.
      await ctx.github.setSecret(authSecret, randomBytes(32).toString("base64url"), await secretScope(ctx));
    },
  };
}

export function mainRulesetStep(): Step {
  return {
    id: "main-ruleset",
    title: "Ruleset on the default branch (pull request, no force-push, no deletion, check verify on an up-to-date branch)",
    async check(ctx) {
      const { defaultBranch } = await ctx.github.repo();
      const found = (await ctx.github.listRulesets()).find((r) => coversMain(r, defaultBranch));
      return { done: found?.strict === true, detail: found?.strict ? `${found.name} #${found.id}` : undefined };
    },
    async run(ctx) {
      const { defaultBranch } = await ctx.github.repo();
      const found = (await ctx.github.listRulesets()).find((r) => coversMain(r, defaultBranch));
      if (found) {
        // A ruleset that covers the branch is reused, never duplicated: only its up-to-date flag is turned on.
        if ((await ctx.github.requireUpToDate(found.id)) === "refused") ctx.log(`  GitHub refused to update ruleset ${found.name} #${found.id}: turn on "Require branches to be up to date before merging" by hand.`);
        return;
      }
      if ((await ctx.github.createRuleset(MAIN_RULESET)) === "refused") {
        ctx.log("  GitHub refused the ruleset (the plan or visibility of the repo): skipped. Run this step again after upgrading.");
      }
    },
  };
}

export function deployProductsStep(product: ProductIdentity): Step {
  return {
    id: "deploy-products",
    title: `${product.id} in ${DEPLOY_PRODUCTS}`,
    async check(ctx) {
      return { done: parseProductList((await ctx.github.listVariables())[DEPLOY_PRODUCTS]).includes(product.id) };
    },
    async run(ctx) {
      const current = parseProductList((await ctx.github.listVariables())[DEPLOY_PRODUCTS]);
      if (!current.includes(product.id)) await ctx.github.setVariable(DEPLOY_PRODUCTS, [...current, product.id].join(","));
    },
  };
}

/**
 * The Production module of `pnpm bootstrap product <id>`. The Neon login is neonctl's own, kept by the CLI and asked
 * once per machine; the production deploy needs no Neon API key, only the connection strings (a
 * project-scoped key is the Previews module's, to branch).
 * `DEPLOY_ENABLED` is not a step: the command turns it on after the doctor of the Product passes.
 */
export function productionSteps(product: ProductIdentity): Step[] {
  return [
    regionStep(product),
    neonProjectStep(product),
    githubEnvironmentStep(),
    databaseSecretsStep(product),
    authSecretStep(product),
    defaultAccountStep(product),
    ...resendSteps(product),
    deployProductsStep(product),
  ];
}
