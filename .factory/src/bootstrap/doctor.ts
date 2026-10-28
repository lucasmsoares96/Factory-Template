import { accountNames } from "./accounts.ts";
import { cloudflareAccountId, cloudflareCredential, LANGUAGE_VARIABLE } from "./common.ts";
import { labelSpecs } from "./labels.ts";
import { LANGUAGES } from "../messages.ts";
import { MERGE_MODES } from "../config.ts";
import { MERGE_MODE_VARIABLE } from "./factory.ts";
import { NO_DNS, NO_LOGIN, deployFirstMessage, productionEnvironment, productSecretName, readDnsState, readWorkerDomainState } from "./domain.ts";
import { hasPreviewTrace, previewEnvironment, previewNames, previewProjectName, previewSecretPresent, PREVIEW_PRODUCTS, BASE_BRANCH } from "./previews.ts";
import { coversMain, DEPLOY_PRODUCTS, missingSecrets, neonHandle, neonOrgId, parseProductList, productionDatabaseUrl, productionSecrets, USE_ENVIRONMENTS } from "./product.ts";
import type { BootstrapDeps, ProductIdentity, StepContext } from "./steps.ts";

export type CheckStatus = "ok" | "missing" | "warn" | "off" | "skip";

export interface Check {
  group: string;
  status: CheckStatus;
  name: string;
  detail?: string;
}

export interface DoctorReport {
  checks: Check[];
  /** False when something required is missing. `off`, `warn` and `skip` do not fail. */
  ok: boolean;
}

/** Which sections of `doctor <id>` run. `previews: "auto"` shows the Previews section only for a Product that already has a trace of them. */
export interface Sections {
  production: boolean;
  /** Default true: the Resend domain and DNS records, and the Worker's Custom Domain. */
  domain?: boolean;
  /** Default `"auto"`. */
  previews?: boolean | "auto";
  /** Default false: the Factory token and Claude's auth (`bootstrap factory`). */
  factory?: boolean;
  /** Default true: the Cloudflare secrets and workers.dev, which the Factory module does not set up. */
  cloudflare?: boolean;
}

const MODULE_SWITCHES = [
  ["DEPLOY_ENABLED", "production deploy"],
  ["PREVIEWS_ENABLED", "PR previews"],
  ["FACTORY_ENABLED", "the Factory"],
] as const;

/**
 * Read-only: lists and reads, never creates or sets anything. The credentials come from `memory` (what this run already
 * holds), then the environment, then, only when a person can answer (`deps.interactive`), a password prompt (not stored).
 */
export async function doctor(
  deps: BootstrapDeps,
  productId?: string,
  memory: StepContext["memory"] = {},
  /** `bootstrap domain <id>` checks the domain only: the Production section would fail it for what it never set up. */
  sections: Sections = { production: true },
  /** `false` at the end of a wizard run: it never asks for a credential, it only re-checks with what the run holds. */
  options: { prompt: boolean } = { prompt: true },
): Promise<DoctorReport> {
  const { github, config } = deps;
  const ctx: StepContext = { ...deps, memory };
  const checks: Check[] = [];
  const add = (group: string, status: CheckStatus, name: string, detail?: string) => checks.push({ group, status, name, detail });

  const [repo, secrets, variables, labels] = await Promise.all([
    github.repo(),
    github.listSecrets(),
    github.listVariables(),
    github.listLabels(),
  ]);

  add("GitHub", "ok", "Repository", `${repo.fullName} (${repo.visibility})`);
  add(
    "GitHub",
    repo.viewerPermission === "ADMIN" ? "ok" : "missing",
    "Repo permission",
    repo.viewerPermission === "ADMIN" ? "admin" : `${repo.viewerPermission.toLowerCase()}: the wizard needs admin to set secrets and variables`,
  );

  const withCloudflare = sections.cloudflare !== false;
  if (withCloudflare) {
    for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
      add("Secrets", secrets.includes(name) ? "ok" : "missing", name, secrets.includes(name) ? undefined : "run `pnpm bootstrap`");
    }
  }
  const claude = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"].filter((n) => secrets.includes(n));
  if (claude.length === 2) add("Secrets", "warn", "Claude auth", "both exist: ANTHROPIC_API_KEY wins; delete one");
  else if (claude.length === 1) add("Secrets", "ok", "Claude auth", claude[0]);
  else add("Secrets", "off", "Claude auth", "the Factory cannot run without CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY");
  add("Secrets", secrets.includes("FACTORY_TOKEN") ? "ok" : "off", "FACTORY_TOKEN", secrets.includes("FACTORY_TOKEN") ? undefined : "run `pnpm bootstrap factory`");

  for (const [name, what] of MODULE_SWITCHES) {
    const on = variables[name] === "true";
    add("Variables", on ? "ok" : "off", name, on ? undefined : `${what} is switched off`);
  }
  const language = variables[LANGUAGE_VARIABLE];
  // Unset is no fault: the Factory writes in the default language. A value it does not know stops every job.
  if (language === undefined) add("Variables", "ok", LANGUAGE_VARIABLE, `not set: the Factory writes in ${config.language}; \`pnpm bootstrap\` asks it`);
  else if ((LANGUAGES as readonly string[]).includes(language)) add("Variables", "ok", LANGUAGE_VARIABLE, language);
  else add("Variables", "warn", LANGUAGE_VARIABLE, `${language} is not one of ${LANGUAGES.join(", ")}: every Factory job fails; run \`pnpm bootstrap --redo language\``);
  const mergeMode = variables[MERGE_MODE_VARIABLE];
  if (mergeMode === undefined) add("Variables", "ok", MERGE_MODE_VARIABLE, "not set: human, every Factory pull request waits for a person; `pnpm bootstrap factory` asks it");
  else if (mergeMode === "all") add("Variables", "warn", MERGE_MODE_VARIABLE, "all: nothing requires a human review; the Factory merges every pull request once its checks pass, changes to its own rules included");
  else if ((MERGE_MODES as readonly string[]).includes(mergeMode)) add("Variables", "ok", MERGE_MODE_VARIABLE, mergeMode);
  else add("Variables", "warn", MERGE_MODE_VARIABLE, `${mergeMode} is not one of ${MERGE_MODES.join(", ")}: every Factory job fails; run \`pnpm bootstrap factory --redo merge-mode\``);
  if (variables.FACTORY_USE_ENVIRONMENTS === "false") {
    add("Variables", "off", "Environments", "secrets live at repo level: the plan or visibility refused environments or the ruleset; rerun the wizard after upgrading");
  }

  const have = new Map(labels.map((l) => [l.name, l]));
  for (const want of labelSpecs(config)) {
    const found = have.get(want.name);
    const same = found && found.color === want.color && found.description === want.description;
    add("Labels", same ? "ok" : "missing", want.name, same ? undefined : found ? "differs from config.ts" : "run `pnpm bootstrap`");
  }

  if (sections.factory) await factoryChecks(ctx, secrets, variables, (status, name, detail) => add("Factory", status, name, detail));

  // The doctor never opens a browser: it uses what this machine already has (memory, env, wrangler's saved login).
  let token: string | undefined;
  try {
    token = withCloudflare ? await cloudflareCredential(ctx, { login: false }) : undefined;
  } catch {
    token = undefined;
  }
  if (!withCloudflare) {
    // The Factory module does not touch Cloudflare.
  } else if (!token) {
    // Secrets cannot be read back: their presence on the forge stands in for the check.
    if (secrets.includes("CLOUDFLARE_API_TOKEN") && secrets.includes("CLOUDFLARE_ACCOUNT_ID")) add("Resources", "ok", "workers.dev", "not re-checked (no saved Cloudflare login on this machine)");
    else add("Resources", "skip", "workers.dev", "run `pnpm --filter @factory/harness exec wrangler login` to check it");
  } else {
    try {
      const subdomain = await deps.cloudflare(token).getWorkersSubdomain(await cloudflareAccountId(ctx, token));
      add("Resources", subdomain ? "ok" : "missing", "workers.dev", subdomain ?? "no subdomain registered; run `pnpm bootstrap`");
    } catch (error) {
      add("Resources", "missing", "workers.dev", (error as Error).message);
    }
  }

  if (productId) {
    const group = `Domain (${productId})`;
    try {
      const product = await deps.product(productId);
      if (sections.production) await productionChecks(ctx, product, variables, repo.defaultBranch, (status, name, detail) => add(`Production (${productId})`, status, name, detail));
      const previews = sections.previews ?? "auto";
      if (previews === true || (previews === "auto" && (await hasPreviewTrace(ctx, product.id, variables, secrets)))) {
        await previewChecks(ctx, product, variables, (status, name, detail) => add(`Previews (${productId})`, status, name, detail));
      }
      const domainAdd = (status: CheckStatus, name: string, detail?: string) => add(group, status, name, detail);
      if (sections.domain === false) {
        // The command did not touch the domain: its checks would only fail it for what it never set up.
      } else if (!product.domain) {
        domainAdd("off", "Domain", `empty: set \`domain\` in apps/${productId}/product.config.ts`);
      } else {
        domainAdd("ok", "Domain", product.domain);
        const key = productSecretName(product.id, "RESEND_API_KEY");
        const keyMissing = (await missingSecrets(ctx, product.id, [key])).length > 0;
        domainAdd(keyMissing ? "off" : "ok", key, keyMissing ? `run \`pnpm bootstrap domain ${product.id}\`` : undefined);
        if (options.prompt && deps.interactive && !memory.resendKey && !memory.resendDeferred && !deps.env.RESEND_API_KEY) {
          const key = (await deps.prompter.password({ id: "resend-key", message: "Paste a Resend API key to check the domain (not stored; leave empty to skip)" })).trim();
          if (key) memory.resendKey = key;
        }
        try {
          const dns = await readDnsState(ctx, product, false);
          if (dns.kind === "no-resend-key") {
            domainAdd(memory.resendDeferred ? "off" : "skip", "Resend domain", memory.resendDeferred ? "deferred in this run" : "export RESEND_API_KEY to check it");
            domainAdd("skip", "DNS records", "needs the Resend domain");
          } else if (dns.kind === "no-domain") {
            domainAdd("off", "Resend domain", `not created (deferred?): the Product keeps the outbox; run \`pnpm bootstrap domain ${product.id}\``);
            domainAdd("skip", "DNS records", "needs the Resend domain");
          } else {
            domainAdd(dns.domain.status === "verified" ? "ok" : "warn", "Resend domain", `${dns.domain.name}: ${dns.domain.status}`);
            if (dns.kind === "no-cloudflare") domainAdd("skip", "DNS records", NO_LOGIN);
            else if (dns.kind === "no-zone") domainAdd("warn", "DNS records", "zone not in this Cloudflare account: create the records by hand");
            else if (dns.kind === "no-dns-permission") domainAdd("skip", "DNS records", NO_DNS);
            else if (dns.missing.length > 0) domainAdd("warn", "DNS records", `${dns.missing.length} missing in ${dns.zone.name}; run \`pnpm bootstrap domain ${product.id} --redo dns-records\``);
            else domainAdd("ok", "DNS records", dns.different.length > 0 ? `all present (${dns.different.length} with another value, left alone)` : "all present");
          }
          const worker = await readWorkerDomainState(ctx, product, false);
          if (worker.kind === "no-cloudflare") domainAdd("skip", "Worker Custom Domain", NO_LOGIN);
          else if (worker.kind === "no-worker") domainAdd("off", "Worker Custom Domain", deployFirstMessage(product.id));
          else if (worker.kind === "no-zone") domainAdd("warn", "Worker Custom Domain", "zone not in this Cloudflare account");
          else if (worker.kind === "attached") domainAdd("ok", "Worker Custom Domain", product.domain);
          else domainAdd("warn", "Worker Custom Domain", `not attached; run \`pnpm bootstrap domain ${product.id} --redo worker-domain\``);
        } catch (error) {
          domainAdd("warn", "Domain checks", (error as Error).message);
        }
      }
    } catch (error) {
      add(group, "missing", "Product", (error as Error).message);
    }
  }

  return { checks, ok: !checks.some((c) => c.status === "missing") };
}

/** The Factory section: what `pnpm bootstrap factory` sets up, required for FACTORY_ENABLED. */
async function factoryChecks(
  ctx: StepContext,
  secrets: string[],
  variables: Record<string, string>,
  add: (status: CheckStatus, name: string, detail?: string) => void,
): Promise<void> {
  const redo = "run `pnpm bootstrap factory`";
  add(secrets.includes("FACTORY_TOKEN") ? "ok" : "missing", "FACTORY_TOKEN", secrets.includes("FACTORY_TOKEN") ? undefined : redo);
  const claude = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"].filter((name) => secrets.includes(name));
  if (claude.length === 2) add("warn", "Claude auth", "both exist: ANTHROPIC_API_KEY wins; delete one");
  else if (claude.length === 1) add("ok", "Claude auth", claude[0]);
  else add("missing", "Claude auth", "export CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY and " + redo);
}

/**
 * The Previews section of `doctor <id>`, by presence (nothing is read from Neon or Cloudflare without a session already in
 * this run). Required: the key, the project id, the KV id and the id in `PREVIEW_PRODUCTS`; the rest is informative.
 */
async function previewChecks(
  ctx: StepContext,
  product: ProductIdentity,
  variables: Record<string, string>,
  add: (status: CheckStatus, name: string, detail?: string) => void,
): Promise<void> {
  const id = product.id;
  const redo = `run \`pnpm bootstrap previews ${id}\``;
  const names = previewNames(id);
  const key = await previewSecretPresent(ctx, id, names.neonKey);
  add(key ? "ok" : "missing", names.neonKey, key ? undefined : redo);
  for (const name of [names.neonProject, names.kv]) add(variables[name] ? "ok" : "missing", name, variables[name] ?? redo);
  const listed = parseProductList(variables[PREVIEW_PRODUCTS]).includes(id);
  add(listed ? "ok" : "missing", `${id} in ${PREVIEW_PRODUCTS}`, listed ? undefined : redo);

  const environment = previewEnvironment(id);
  if ((await ctx.github.listEnvironments()).includes(environment)) add("ok", `Environment ${environment}`, "only the default branch may deploy");
  else if (variables[USE_ENVIRONMENTS] === "false") add("off", `Environment ${environment}`, "refused by the plan or visibility: the secrets are at repo level");
  else add("warn", `Environment ${environment}`, redo);

  const neon = await neonHandle(ctx, false);
  if (!neon) {
    // No login from the doctor: the recorded project id stands in for the project (the line above says if it is missing).
    if (variables[names.neonProject]) add("ok", "Neon preview project", "ok (project id recorded; not looked up)");
    return;
  }
  try {
    const found = (await neon.listProjects(await neonOrgId(ctx, neon))).filter((p) => p.name === previewProjectName(id));
    if (found.length !== 1) return add(found.length === 0 ? "missing" : "warn", "Neon preview project", found.length === 0 ? redo : `${found.length} projects are named ${previewProjectName(id)}`);
    const branch = await neon.defaultBranchName(found[0]!.id);
    add(branch === BASE_BRANCH ? "ok" : "warn", "Neon preview project", branch === BASE_BRANCH ? found[0]!.id : `${found[0]!.id}: default branch is ${branch}, not ${BASE_BRANCH}; ${redo} with --redo preview-neon-project`);
  } catch (error) {
    add("warn", "Neon preview project", (error as Error).message);
  }
}

/**
 * The Production section of `doctor <id>`: what the deploy of the Product reads. Required (and so able to turn the
 * exit code red and hold `DEPLOY_ENABLED` off): the three secrets and the id in `DEPLOY_PRODUCTS`. The rest is informative.
 */
async function productionChecks(
  ctx: StepContext,
  product: ProductIdentity,
  variables: Record<string, string>,
  defaultBranch: string,
  add: (status: CheckStatus, name: string, detail?: string) => void,
): Promise<void> {
  const id = product.id;
  const redo = `run \`pnpm bootstrap product ${id}\``;
  const names = productionSecrets(id);
  const missing = new Set(await missingSecrets(ctx, id, [names.databaseUrl, names.databaseUrlPooled, names.authSecret]));
  for (const name of [names.databaseUrl, names.databaseUrlPooled, names.authSecret]) add(missing.has(name) ? "missing" : "ok", name, missing.has(name) ? redo : undefined);

  const environment = productionEnvironment(id);
  if ((await ctx.github.listEnvironments()).includes(environment)) add("ok", `Environment ${environment}`, "only the default branch may deploy");
  else if (variables[USE_ENVIRONMENTS] === "false") add("off", `Environment ${environment}`, "refused by the plan or visibility: the secrets are at repo level");
  else add("warn", `Environment ${environment}`, redo);

  const listed = parseProductList(variables[DEPLOY_PRODUCTS]).includes(id);
  add(listed ? "ok" : "missing", `${id} in ${DEPLOY_PRODUCTS}`, listed ? undefined : redo);

  const ruleset = (await ctx.github.listRulesets()).find((r) => coversMain(r, defaultBranch));
  if (!ruleset) add("off", "Ruleset on the default branch", "none (the plan may refuse it) or not made yet");
  else if (!ruleset.strict) add("off", "Ruleset on the default branch", `${ruleset.name} #${ruleset.id} does not require branches to be up to date before merging: ${redo}`);
  else add("ok", "Ruleset on the default branch", `${ruleset.name} #${ruleset.id}`);

  await accountChecks(ctx, product, variables, add, redo);

  const neon = await neonHandle(ctx, false);
  if (!neon) {
    // No login from the doctor: the presence of the database secrets stands in for the project.
    if (missing.has(names.databaseUrl) || missing.has(names.databaseUrlPooled)) add("skip", "Neon project", "not looked up (no Neon session or NEON_API_KEY)");
    else add("ok", "Neon project", "ok (database secrets present; project not looked up)");
  }
  else {
    try {
      const orgId = await neonOrgId(ctx, neon);
      const found = (await neon.listProjects(orgId)).filter((p) => p.name === id);
      if (found.length === 1) add("ok", "Neon project", found[0]!.id);
      else if (found.length > 1) add("warn", "Neon project", `${found.length} projects are named ${id}`);
      else add("missing", "Neon project", redo);
    } catch (error) {
      add("warn", "Neon project", (error as Error).message);
    }
  }
}

/**
 * The account's secret and variable are required (the smoke job signs in with them). Whether the account exists
 * is read from the production database when this run can reach it (a Neon session or `NEON_API_KEY`); otherwise `skip`.
 */
async function accountChecks(
  ctx: StepContext,
  product: ProductIdentity,
  variables: Record<string, string>,
  add: (status: CheckStatus, name: string, detail?: string) => void,
  redo: string,
): Promise<void> {
  const names = accountNames(product.id);
  const missing = (await missingSecrets(ctx, product.id, [names.password])).length > 0;
  add(missing ? "missing" : "ok", names.password, missing ? redo : undefined);
  const email = variables[names.email];
  add(email ? "ok" : "missing", names.email, email ?? redo);

  let url: string | undefined;
  try {
    url = await productionDatabaseUrl(ctx, product, false);
  } catch (error) {
    add("warn", "Accounts", (error as Error).message);
    return;
  }
  if (!url) {
    // No session in memory and no key: the doctor never opens a Neon login, presence of the secret and the email stands in.
    if (!missing && email) add("ok", "Account", "ok (secret and email present; DB not read)");
    else add("skip", "Account", "the production database was not read (no Neon session or NEON_API_KEY)");
    return;
  }
  try {
    if (!email) add("missing", "Account", `no ${names.email}; ${redo}`);
    else {
      const has = await ctx.accounts.verifiedUserExists(url, email);
      add(has ? "ok" : "missing", "Account", has ? email : `${email} is not a verified user in the database; ${redo}`);
    }
  } catch (error) {
    add("warn", "Accounts", (error as Error).message);
  }
}

export function formatReport(report: DoctorReport): string {
  const lines: string[] = [];
  let group = "";
  for (const check of report.checks) {
    if (check.group !== group) {
      group = check.group;
      lines.push("", `${group}`);
    }
    lines.push(`  ${check.status.padEnd(8)}${check.name}${check.detail ? `  ${check.detail}` : ""}`);
  }
  lines.push("", report.ok ? "doctor: everything required is in place." : "doctor: something required is missing.");
  return lines.join("\n").trimStart();
}
