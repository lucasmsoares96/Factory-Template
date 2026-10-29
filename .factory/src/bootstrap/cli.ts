import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { SkeletonAccounts } from "./accounts.ts";
import { CloudflareApi } from "./cloudflare.ts";
import { commonSteps } from "./common.ts";
import { runDestroy } from "./destroy.ts";
import { doctor, formatReport, type Sections } from "./doctor.ts";
import { GhCli } from "./github.ts";
import { GitHubTokenApi } from "./token.ts";
import { clackPrompter } from "./prompter.ts";
import { domainSteps } from "./domain.ts";
import { FACTORY_ENABLED, factorySteps } from "./factory.ts";
import { offerExample } from "./example.ts";
import { productionSteps } from "./product.ts";
import { PREVIEWS_ENABLED, previewSteps } from "./previews.ts";
import { ResendApi } from "./resend.ts";
import { StripeApi } from "./stripe.ts";
import { BILLING_MISSING_FEATURE, billingEnvironment, billingSteps } from "./billing.ts";
import { NeonCli } from "./neon.ts";
import { WranglerCli } from "./wrangler.ts";
import { runSteps, type BootstrapDeps, type ProductIdentity, type StepContext } from "./steps.ts";

export type { BootstrapDeps } from "./steps.ts";

const USAGE = `Usage: pnpm bootstrap [command] [options]

Commands:
  (none)                 Set up the common part: Cloudflare token and account, workers.dev, labels, and the
                         language of the Factory's public text (en or pt-BR, asked once: FACTORY_LANGUAGE).
                         Looks at the current state and skips what already exists, so it is safe to rerun.
  doctor                 Read-only check of secrets, variables, labels and resources; shows what is switched off.
  domain <id>            Per Product: Resend sending domain, its DNS records in Cloudflare, a restricted
                         Resend key and the Worker's Custom Domain. Skips what exists, so it is safe to rerun.
  product <id>           Per Product, the Production module: Neon project, GitHub environment, <ID>_ secrets,
                         the account you choose, made straight in the production database (the smoke signs
                         in as it), the Resend domain (deferrable), the ruleset on main and the id
                         in DEPLOY_PRODUCTS.
                         Neon signs in through your browser (or NEON_API_KEY in the environment); the login
                         is temporary and removed when the command ends. Turns DEPLOY_ENABLED on once the
                         doctor of the Product passes.
  previews <id>          Per Product, the Previews module (needs the Production module first): the Neon project
                         <id>-preview with default branch base, a Neon API key limited to it (minted with your
                         login, or pasted once if Neon refuses), the preview KV, the <id>-preview environment and the id
                         in PREVIEW_PRODUCTS. One Neon login per run, only when there is Neon work. Turns
                         PREVIEWS_ENABLED on once the doctor of the previews passes.
  billing <id>           Per Product, the optional billing module (after product; the Product must list the billing
                         Feature): a restricted Stripe key for the Previews sandbox and one for the real account (a
                         pre-filled link each; hidden prompt, or STRIPE_SANDBOX_KEY / STRIPE_LIVE_KEY), the plans,
                         payment methods and Customer Portal written to both accounts, and the real account's events
                         endpoint. The deploy hands the key and the endpoint secret to the Worker once all are set.
  env <id>               Lists the variables, secrets and environment variables of the billing module.
  all <id>               The Production module, then asks whether to set billing up now.
  factory                The Factory module (after the common part): your own fine-grained token, limited to this
                         repository (the one thing asked, once, hidden; a pre-filled link is printed, and it goes straight
                         to the FACTORY_TOKEN secret), and Claude's auth taken from CLAUDE_CODE_OAUTH_TOKEN or
                         ANTHROPIC_API_KEY in the environment (or an existing secret), and the Merge Mode
                         (FACTORY_MERGE_MODE: human, the default, safe, or all behind a typed confirmation; asked
                         once, human without a terminal unless FACTORY_MERGE_MODE is in the environment).
                         Turns FACTORY_ENABLED on once the doctor passes. A rerun with the secrets in place asks nothing
                         about credentials. At the end, with a terminal, it offers (default no) an example issue that the
                         Factory solves in about 15 minutes, using Claude credits; everything it creates is deleted.
  destroy [scope]        Deletes what the wizard made, after listing it (the production database is highlighted) and
                         asking you to type the id. Scope: product <id>, previews <id>, factory, common; none = everything
                         (type "all"). Needs a terminal and refuses when CI is set. Never deletes the repository, issues,
                         labels, accounts or DNS records. Agents must never run it.
  help                   Show this message.

Options:
  --redo <step>          Redo one step even if it looks done (repeatable): cloudflare-token, workers-dev, labels,
                         language (asks the language again);
                         for the domain command: resend-domain, dns-records, restricted-resend-key, worker-domain;
                         for the product command: neon-project, github-environment, database-secrets, auth-secret,
                         default-account (asks again, resets the password and the secret), the four domain steps, main-ruleset, deploy-products;
                         for the billing command: keys (makes both keys again), plans (asks the plans again), webhook (a new endpoint and secret);
                         for the previews command: preview-environment, preview-neon-project, preview-neon-key, preview-kv,
                         preview-account (asks again, replaces the password), preview-products;
                         for the factory command: labels, factory-token (asks for the token again), claude-auth, auto-merge,
                         merge-mode (asks the Merge Mode again).

The wizard ends by running the doctor with the credentials it already holds, so one run is enough.
Run \`pnpm bootstrap doctor [<id>]\` on its own whenever something looks off; it checks Cloudflare with
wrangler's saved login (or CLOUDFLARE_API_TOKEN) and never opens a browser; with no RESEND_API_KEY it asks once, hidden and not stored.
Only \`gh\` (logged in with \`gh auth login\`) must be installed. Nothing is written to disk, secrets included.`;

/** Entry point; returns the process exit code. */
export async function runBootstrap(argv: string[], deps: BootstrapDeps): Promise<number> {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { redo: { type: "string", multiple: true } } });
  const [command, productId] = positionals;

  if (command === "destroy") {
    const memory: StepContext["memory"] = {};
    try {
      return await runDestroy(positionals.slice(1), { ...deps, memory });
    } finally {
      await memory.neon?.close();
    }
  }
  if (command === "help") {
    deps.log(USAGE);
    return 0;
  }
  if (command === "domain") {
    if (!productId) {
      deps.log(`Usage: pnpm bootstrap domain <id> [--redo <step>]`);
      return 1;
    }
    const product = await productOrAsk(deps, productId);
    if (!product) return 1;
    const memory: StepContext["memory"] = {};
    await runSteps(domainSteps(product), { ...deps, memory }, values.redo ?? []);
    return finish(deps, productId, memory, { production: false, previews: false });
  }
  if (command === "env") {
    if (!productId) {
      deps.log("Usage: pnpm bootstrap env <id>");
      return 1;
    }
    deps.log(billingEnvironment(productId).join("\n"));
    return 0;
  }
  if (command === "billing") {
    if (!productId) {
      deps.log(`Usage: pnpm bootstrap billing <id> [--redo keys|plans|webhook]`);
      return 1;
    }
    const product = await productOrAsk(deps, productId);
    if (!product) return 1;
    return runBilling(deps, product, values.redo ?? []);
  }
  if (command === "all") {
    if (!productId) {
      deps.log(`Usage: pnpm bootstrap all <id>`);
      return 1;
    }
    const code = await runBootstrap(["product", productId, ...(values.redo ?? []).flatMap((step) => ["--redo", step])], deps);
    if (code !== 0 || !deps.interactive) return code;
    const product = await productOrAsk(deps, productId);
    if (!product?.billing) return code;
    if (!(await deps.prompter.confirm({ id: "billing-setup", message: `Set up billing for ${productId} now (Stripe keys, plans, events endpoint)?`, initial: false }))) {
      deps.log(`Billing skipped. Run when you want it: pnpm bootstrap billing ${productId}`);
      return code;
    }
    return runBilling(deps, product, []);
  }
  if (command === "previews") {
    if (!productId) {
      deps.log(`Usage: pnpm bootstrap previews <id> [--redo <step>]`);
      return 1;
    }
    const product = await productOrAsk(deps, productId);
    if (!product) return 1;
    const memory: StepContext["memory"] = {};
    try {
      await runSteps(previewSteps(product), { ...deps, memory }, values.redo ?? []);
      return await finish(deps, productId, memory, { production: false, domain: false, previews: true }, PREVIEWS_ENABLED);
    } finally {
      await memory.neon?.close();
    }
  }
  if (command === "product") {
    if (!productId) {
      deps.log(`Usage: pnpm bootstrap product <id> [--redo <step>]`);
      return 1;
    }
    const product = await productOrAsk(deps, productId);
    if (!product) return 1;
    const memory: StepContext["memory"] = {};
    try {
      await runSteps(productionSteps(product), { ...deps, memory }, values.redo ?? []);
      const code = await finish(deps, productId, memory, { production: true, previews: false }, "DEPLOY_ENABLED");
      deps.log(`After the first deploy, attach the domain with: pnpm bootstrap domain ${productId} --redo worker-domain`);
      return code;
    } finally {
      await memory.neon?.close();
    }
  }
  if (command === "factory") {
    const memory: StepContext["memory"] = {};
    await runSteps(factorySteps, { ...deps, memory }, values.redo ?? []);
    const code = await finish(deps, undefined, memory, { production: false, domain: false, previews: false, factory: true, cloudflare: false }, FACTORY_ENABLED);
    // Only a Factory that passed the doctor and is switched on can solve an example issue.
    if (code !== 0 || !deps.interactive || (await deps.github.listVariables())[FACTORY_ENABLED] !== "true") return code;
    return offerExample({ ...deps, memory });
  }
  if (command === "doctor") {
    const memory: StepContext["memory"] = {};
    try {
      const report = await doctor(deps, productId, memory);
      deps.log(formatReport(report));
      return report.ok ? 0 : 1;
    } finally {
      await memory.neon?.close();
    }
  }
  if (command !== undefined) {
    deps.log(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  const memory: StepContext["memory"] = {};
  await runSteps(commonSteps, { ...deps, memory }, values.redo ?? []);
  return finish(deps, undefined, memory);
}

/** The billing module: steps, then the doctor of the Product with the keys the run holds. */
async function runBilling(deps: BootstrapDeps, product: ProductIdentity, redo: string[]): Promise<number> {
  if (!product.billing) {
    deps.log(BILLING_MISSING_FEATURE(product.id));
    return 1;
  }
  const memory: StepContext["memory"] = {};
  await runSteps(billingSteps(product), { ...deps, memory }, redo);
  return finish(deps, product.id, memory, { production: false, domain: false, previews: false, billing: true, cloudflare: false });
}

/** The Product's identity; an empty `domain` is asked for (for this run only). `undefined` when the Product does not exist. */
async function productOrAsk(deps: BootstrapDeps, productId: string): Promise<ProductIdentity | undefined> {
  let product: ProductIdentity;
  try {
    product = await deps.product(productId);
  } catch (error) {
    deps.log((error as Error).message);
    return undefined;
  }
  if (!product.domain) {
    deps.prompter.note(`apps/${productId}/product.config.ts has no \`domain\`. Set it there (the wizard never rewrites that file); using the answer below for this run only.`);
    product = { ...product, domain: (await deps.prompter.text({ id: "product-domain", message: `Domain of ${productId} (e.g. example.com)` })).trim() };
  }
  return product;
}

/** The last step of a wizard run: the doctor, with the credentials this run holds. The exit code is its verdict. */
async function finish(
  deps: BootstrapDeps,
  productId: string | undefined,
  memory: StepContext["memory"],
  sections: Sections = { production: true },
  /** The module switch to turn on when the doctor passes (`DEPLOY_ENABLED` or `PREVIEWS_ENABLED`). */
  enable?: "DEPLOY_ENABLED" | "PREVIEWS_ENABLED" | "FACTORY_ENABLED",
): Promise<number> {
  deps.log("\nChecking everything:\n");
  let report = await doctor(deps, productId, memory, sections, { prompt: false });
  // Only a Product whose doctor passes gets its workflow switched on; it shows as skipped until then.
  // It is switched on before the report is printed, so the report shows the state the run ends in.
  let switchedOn = false;
  if (enable && report.ok && (await deps.github.listVariables())[enable] !== "true") {
    await deps.github.setVariable(enable, "true");
    switchedOn = true;
    report = await doctor(deps, productId, memory, sections, { prompt: false });
  }
  deps.log(formatReport(report));
  if (enable === "DEPLOY_ENABLED") {
    if (switchedOn) deps.log("DEPLOY_ENABLED=true: every merge into the default branch now deploys the Products it affects.");
    else if (!report.ok) deps.log("DEPLOY_ENABLED stays off: fix what the doctor lists as missing and run this command again.");
    if (report.ok && productId) {
      // A push deploys only the Products it affects, so a Product set up after its last change waits for a deploy by hand.
      deps.log(`First deploy of ${productId}: run the Deploy workflow by hand once (Actions → Deploy → Run workflow), or: gh workflow run factory-deploy.yml --ref main`);
    }
  } else if (enable === "PREVIEWS_ENABLED") {
    if (switchedOn) deps.log("PREVIEWS_ENABLED=true: every pull request that affects a Product listed in PREVIEW_PRODUCTS now gets a preview (by author with write access, or by the preview label).");
    else if (!report.ok) deps.log("PREVIEWS_ENABLED stays off: fix what the doctor lists as missing and run this command again.");
    // The `base` branch gets its schema from the deploy of the default branch (which needs `main` to deploy the Product too).
    if (report.ok) deps.log("The preview database starts from `base`, which the next deploy of the default branch migrates (run the Deploy workflow by hand to do it now).");
  } else if (enable === "FACTORY_ENABLED") {
    if (switchedOn) deps.log("FACTORY_ENABLED=true: an issue labelled ready-for-agent by someone with write access now becomes a pull request.");
    else if (!report.ok) deps.log("FACTORY_ENABLED stays off: fix what the doctor lists as missing and run this command again.");
  }
  return report.ok ? 0 : 1;
}

/** Ids of the directories of `apps/` that hold a `product.config.ts`. */
export async function listProducts(): Promise<string[]> {
  const apps = resolve(import.meta.dirname, "../../../apps");
  if (!existsSync(apps)) return [];
  return readdirSync(apps)
    .filter((id) => existsSync(resolve(apps, id, "product.config.ts")))
    .sort();
}

const ProductFile = z.object({ id: z.string(), title: z.string(), emailFrom: z.string(), domain: z.string() });

/** Imports `apps/<id>/product.config.ts` (data only, as ticket 07 requires). */
export async function loadProduct(id: string): Promise<ProductIdentity> {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`"${id}" is not a Product id (lower-case, dashes).`);
  const file = resolve(import.meta.dirname, "../../../apps", id, "product.config.ts");
  if (!existsSync(file)) throw new Error(`No Product at apps/${id}/product.config.ts`);
  const parsed = ProductFile.safeParse((await import(pathToFileURL(file).href)).default);
  if (!parsed.success) throw new Error(`apps/${id}/product.config.ts does not export a valid Product: ${parsed.error.message}`);
  return { ...parsed.data, billing: listsBilling(id) };
}

/** Whether `apps/<id>/src/features/index.ts` calls `billing(...)` (comments cut away): the file is TSX-free but imports workspace packages, so it is read as text. */
function listsBilling(id: string): boolean {
  const file = resolve(import.meta.dirname, "../../../apps", id, "src/features/index.ts");
  if (!existsSync(file)) return false;
  const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return /\bbilling\s*\(/.test(code);
}

if (import.meta.main) {
  const env = process.env;
  // Every Neon client opened by this process, closed on `exit` too (a Ctrl+C makes clack exit at once).
  // Closing keeps neonctl's login, so the next run does not open the browser again.
  const openNeon = new Set<NeonCli>();
  process.on("exit", () => openNeon.forEach((client) => client.closeSync()));
  // While the example issue exists, the first Ctrl-C stops the wait and lets the cleanup run; a second one exits.
  const interrupt = new AbortController();
  let holdInterrupt = false;
  process.on("SIGINT", () => {
    if (holdInterrupt && !interrupt.signal.aborted) interrupt.abort();
    else process.exit(130);
  });
  process.on("SIGTERM", () => process.exit(143));
  try {
    process.exitCode = await runBootstrap(process.argv.slice(2), {
      github: new GhCli(),
      cloudflare: (token) => new CloudflareApi(token),
      wrangler: new WranglerCli({ env }),
      neon: (options) => {
        const client = new NeonCli({ ...options, env });
        openNeon.add(client);
        return client;
      },
      accounts: new SkeletonAccounts(),
      token: (token) => new GitHubTokenApi(token),
      resend: (key) => new ResendApi(key),
      stripe: (key) => new StripeApi(key),
      product: loadProduct,
      listProducts,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      prompter: clackPrompter,
      env,
      log: (line) => console.log(line),
      config: loadConfig(env),
      interactive: Boolean(process.stdin.isTTY),
      example: { interrupt: { signal: interrupt.signal, hold: (on) => void (holdInterrupt = on) } },
    });
  } catch (error) {
    console.error(`bootstrap: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
