import { randomBytes } from "node:crypto";
import type { NeonClient, NeonProject, RulesetInfo, RulesetSpec } from "./clients.ts";
import { passwordProblem } from "../../../packages/skeleton/src/platform/password-rules.ts";
import { generatePassword, smokeEmail, smokeNames } from "./accounts.ts";
import { domainSteps, productionEnvironment, productSecretName, secretScope } from "./domain.ts";
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

/** `a, b c` and `a,b` both read as two ids. */
export function parseProductList(value: string | undefined): string[] {
  return (value ?? "").split(/[\s,]+/).filter(Boolean);
}

/** The ruleset the wizard makes for the default branch: a pull request, no force-push, no deletion, the `verify` check. */
export const MAIN_RULESET: RulesetSpec = {
  name: "main",
  include: ["~DEFAULT_BRANCH"],
  rules: ["deletion", "non_fast_forward", "pull_request", "required_status_checks"],
  requiredChecks: ["verify"],
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
    ctx.log("Signing in to Neon: your browser opens. The login lives in a temporary folder that is removed (and logged out) when this command ends.");
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

/** The project named `name` in the org. Names are not unique in Neon: with duplicates the person picks (or the check cannot say). */
export async function findProject(ctx: StepContext, neon: NeonClient, name: string, prompt: boolean): Promise<NeonProject | null | "ambiguous"> {
  const found = (await neon.listProjects(await neonOrgId(ctx, neon))).filter((p) => p.name === name);
  if (found.length <= 1) return found[0] ?? null;
  if (!prompt) return "ambiguous";
  const id = await ctx.prompter.select({
    id: "neon-project-pick",
    message: `${found.length} Neon projects are named ${name}. Which one is the production database? (The wizard never deletes one.)`,
    options: found.map((p) => ({ value: p.id, label: p.id })),
  });
  return found.find((p) => p.id === id) ?? null;
}

async function ensureProject(ctx: StepContext, neon: NeonClient, name: string): Promise<NeonProject> {
  const found = await findProject(ctx, neon, name, true);
  if (found && found !== "ambiguous") return found;
  const made = await neon.createProject(name, await neonOrgId(ctx, neon));
  ctx.log(`  created the Neon project ${made.name}`);
  return made;
}

/** Secret names missing from the places the deploy reads them (environment, then repo). */
export async function missingSecrets(ctx: StepContext, productId: string, names: string[]): Promise<string[]> {
  const scope = await secretScope(ctx, productId);
  const have = new Set([...(await ctx.github.listSecrets(scope)), ...(scope.environment ? await ctx.github.listSecrets() : [])]);
  return names.filter((name) => !have.has(name));
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
        const missing = await missingSecrets(ctx, product.id, [databaseUrl, databaseUrlPooled]);
        return { done: missing.length === 0, detail: "not verified: set NEON_API_KEY to look it up" };
      }
      const found = await findProject(ctx, neon, product.id, false);
      if (found === "ambiguous") return { done: false, detail: "several projects have this name" };
      return { done: found !== null, detail: found?.id };
    },
    async run(ctx) {
      const neon = await neonHandle(ctx, true);
      if (neon) await ensureProject(ctx, neon, product.id);
    },
  };
}

export function githubEnvironmentStep(product: ProductIdentity): Step {
  const name = productionEnvironment(product.id);
  return {
    id: "github-environment",
    title: `GitHub environment ${name} (only main may deploy)`,
    async check(ctx) {
      return { done: (await ctx.github.listEnvironments()).includes(name) };
    },
    async run(ctx) {
      const { defaultBranch } = await ctx.github.repo();
      if ((await ctx.github.upsertEnvironment(name, { branch: defaultBranch })) === "created") {
        // A rerun after an upgrade brings the environments back: the secrets in the repo keep working meanwhile.
        if ((await ctx.github.listVariables())[USE_ENVIRONMENTS] === "false") await ctx.github.setVariable(USE_ENVIRONMENTS, "true");
        return;
      }
      if ((await ctx.github.listVariables())[USE_ENVIRONMENTS] !== "false") await ctx.github.setVariable(USE_ENVIRONMENTS, "false");
      ctx.log(`  GitHub refused the environment (the plan or visibility of the repo): the secrets of ${product.id} stay at repo level and ${USE_ENVIRONMENTS}=false. Run this step again after upgrading.`);
    },
  };
}

export function databaseSecretsStep(product: ProductIdentity): Step {
  const { databaseUrl, databaseUrlPooled } = productionSecrets(product.id);
  return {
    id: "database-secrets",
    title: `Database URLs (${databaseUrl}, ${databaseUrlPooled})`,
    async check(ctx) {
      return { done: (await missingSecrets(ctx, product.id, [databaseUrl, databaseUrlPooled])).length === 0 };
    },
    async run(ctx) {
      const neon = await neonHandle(ctx, true);
      if (!neon) return ctx.log("No Neon key: the database URLs were not stored. Export NEON_API_KEY or run again.");
      const project = await ensureProject(ctx, neon, product.id);
      const orgId = await neonOrgId(ctx, neon);
      const scope = await secretScope(ctx, product.id);
      // Each string goes from the CLI's stdout to the forge's stdin and is never held longer than this call.
      // The direct string also stays in memory for this run only: the account steps migrate and insert through it.
      ctx.memory.databaseUrl = await neon.connectionString(project.id, { pooled: false, orgId });
      await ctx.github.setSecret(databaseUrl, ctx.memory.databaseUrl, scope);
      await ctx.github.setSecret(databaseUrlPooled, await neon.connectionString(project.id, { pooled: true, orgId }), scope);
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
  const found = await findProject(ctx, neon, product.id, prompt);
  if (!found || found === "ambiguous") return undefined;
  ctx.memory.databaseUrl = await neon.connectionString(found.id, { pooled: false, orgId: await neonOrgId(ctx, neon) });
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
async function askPassword(ctx: StepContext, id: string): Promise<string> {
  for (let attempt = 1; attempt <= PASSWORD_ATTEMPTS; attempt++) {
    const password = await ctx.prompter.password({ id, message: "Password of the default account (hidden, never stored)" });
    const problem = passwordProblem(password);
    if (problem) ctx.log(`  ${problem}`);
    else if ((await ctx.prompter.password({ id: `${id}-confirm`, message: "Type it again" })) === password) return password;
    else ctx.log("  The two passwords differ.");
  }
  throw new Error(`No valid password after ${PASSWORD_ATTEMPTS} tries.`);
}

/** The email the person types for the default account. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function defaultAccountStep(product: ProductIdentity): Step {
  const smoke = smokeEmail(product.id, product.domain);
  return {
    id: "default-account",
    title: `Default account in the ${product.id} production database (the app can be entered without signing up)`,
    async check(ctx) {
      // Done when anyone besides the smoke account can already enter; telling that needs the database, so Neon is asked.
      const url = await productionDatabaseUrl(ctx, product, true);
      return { done: url ? await ctx.accounts.hasVerifiedUserOtherThan(url, smoke) : false };
    },
    async run(ctx) {
      const url = await requireDatabaseUrl(ctx, product);
      const email = (await ctx.prompter.text({ id: "default-account-email", message: "Email of the default account (created already verified)" })).trim().toLowerCase();
      if (!EMAIL.test(email)) throw new Error(`"${email}" is not an email.`);
      if (!ctx.redo?.includes("default-account") && (await ctx.accounts.userExists(url, email))) {
        return ctx.log(`  ${email} already exists: left alone (--redo default-account resets its password).`);
      }
      const password = await askPassword(ctx, "default-account-password");
      const result = await createAccount(ctx, url, product, { email, name: email.split("@")[0]!, password });
      ctx.log(result === "created" ? `  created ${email}` : `  reset the password of ${email}`);
    },
  };
}

export function smokeAccountStep(product: ProductIdentity): Step {
  const { password: passwordName, email: emailName } = smokeNames(product.id);
  const email = smokeEmail(product.id, product.domain);
  return {
    id: "smoke-account",
    title: `Smoke account ${email} (${passwordName}, ${emailName})`,
    async check(ctx) {
      const stored = (await missingSecrets(ctx, product.id, [passwordName])).length === 0 && (await ctx.github.listVariables())[emailName] === email;
      // The forge cannot be read back for the password, so the database is only consulted when this run already holds its URL.
      const url = ctx.memory.databaseUrl;
      return { done: stored && (url ? await ctx.accounts.userExists(url, email) : true), detail: email };
    },
    async run(ctx) {
      const url = await requireDatabaseUrl(ctx, product);
      // The password is never printed or kept: it goes into the database (hashed) and into the secret, once. An account
      // that exists without a stored secret cannot be signed in to, so it gets a new password.
      const password = generatePassword();
      const result = await createAccount(ctx, url, product, { email, name: "Smoke", password });
      await ctx.github.setSecret(passwordName, password, await secretScope(ctx, product.id));
      await ctx.github.setVariable(emailName, email);
      ctx.log(result === "created" ? `  created ${email}` : `  rotated the password of ${email}`);
    },
  };
}

export function authSecretStep(product: ProductIdentity): Step {
  const { authSecret } = productionSecrets(product.id);
  return {
    id: "auth-secret",
    title: `Better Auth secret (${authSecret})`,
    async check(ctx) {
      return { done: (await missingSecrets(ctx, product.id, [authSecret])).length === 0 };
    },
    async run(ctx) {
      // Secrets cannot be read back, so a redo makes a new one and every session signed with the old one ends.
      await ctx.github.setSecret(authSecret, randomBytes(32).toString("base64url"), await secretScope(ctx, product.id));
    },
  };
}

export function mainRulesetStep(): Step {
  return {
    id: "main-ruleset",
    title: "Ruleset on the default branch (pull request, no force-push, no deletion, check verify)",
    async check(ctx) {
      const { defaultBranch } = await ctx.github.repo();
      const found = (await ctx.github.listRulesets()).find((r) => coversMain(r, defaultBranch));
      return { done: found !== undefined, detail: found ? `${found.name} #${found.id}` : undefined };
    },
    async run(ctx) {
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
 * The Production module of `pnpm bootstrap product <id>`. The Neon login is the wizard's own (a throwaway `neonctl`
 * session) and is never stored; the production deploy needs no Neon API key, only the connection strings (a
 * project-scoped key is the Previews module's, to branch).
 * `DEPLOY_ENABLED` is not a step: the command turns it on after the doctor of the Product passes.
 */
export function productionSteps(product: ProductIdentity): Step[] {
  return [
    neonProjectStep(product),
    githubEnvironmentStep(product),
    databaseSecretsStep(product),
    authSecretStep(product),
    defaultAccountStep(product),
    smokeAccountStep(product),
    ...domainSteps(product),
    mainRulesetStep(),
    deployProductsStep(product),
  ];
}
