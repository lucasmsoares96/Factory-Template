import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { SkeletonAccounts } from "./accounts.ts";
import { CloudflareApi } from "./cloudflare.ts";
import { commonSteps } from "./common.ts";
import { doctor, formatReport } from "./doctor.ts";
import { GhCli } from "./github.ts";
import { clackPrompter } from "./prompter.ts";
import { domainSteps } from "./domain.ts";
import { productionSteps } from "./product.ts";
import { ResendApi } from "./resend.ts";
import { NeonCli } from "./neon.ts";
import { runSteps, type BootstrapDeps, type ProductIdentity, type StepContext } from "./steps.ts";

export type { BootstrapDeps } from "./steps.ts";

const USAGE = `Usage: pnpm bootstrap [command] [options]

Commands:
  (none)                 Set up the common part: Cloudflare token and account, workers.dev, labels.
                         Looks at the current state and skips what already exists, so it is safe to rerun.
  doctor                 Read-only check of secrets, variables, labels and resources; shows what is switched off.
  domain <id>            Per Product: Resend sending domain, its DNS records in Cloudflare, a restricted
                         Resend key and the Worker's Custom Domain. Skips what exists, so it is safe to rerun.
  product <id>           Per Product, the Production module: Neon project, GitHub environment, <ID>_ secrets,
                         two accounts made straight in the production database (a default one you choose, and
                         a smoke one for CI), the Resend domain (deferrable), the ruleset on main and the id
                         in DEPLOY_PRODUCTS.
                         Neon signs in through your browser (or NEON_API_KEY in the environment); the login
                         is temporary and removed when the command ends. Turns DEPLOY_ENABLED on once the
                         doctor of the Product passes.
  help                   Show this message.

Options:
  --redo <step>          Redo one step even if it looks done (repeatable): cloudflare-token, workers-dev, labels;
                         for the domain command: resend-domain, dns-records, restricted-resend-key, worker-domain;
                         for the product command: neon-project, github-environment, database-secrets, auth-secret,
                         default-account (asks again and resets the password), smoke-account (rotates the
                         password), the four domain steps, main-ruleset, deploy-products.

The wizard ends by running the doctor with the credentials it already holds, so one run is enough.
Run \`pnpm bootstrap doctor [<id>]\` on its own whenever something looks off; with no CLOUDFLARE_API_TOKEN (or
RESEND_API_KEY) in the environment it asks for it once, hidden and not stored (without a terminal it says \`skip\`).
Only \`gh\` (logged in with \`gh auth login\`) must be installed. Nothing is written to disk, secrets included.`;

/** Entry point; returns the process exit code. */
export async function runBootstrap(argv: string[], deps: BootstrapDeps): Promise<number> {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { redo: { type: "string", multiple: true } } });
  const [command, productId] = positionals;

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
    return finish(deps, productId, memory, { production: false });
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
      return await finish(deps, productId, memory, { production: true }, true);
    } finally {
      await memory.neon?.close();
    }
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
  sections: { production: boolean } = { production: true },
  enableDeploy = false,
): Promise<number> {
  deps.log("\nChecking everything:\n");
  const report = await doctor(deps, productId, memory, sections);
  deps.log(formatReport(report));
  // Only a Product whose doctor passes gets the deploy switched on; the workflow shows as skipped until then.
  if (enableDeploy && report.ok && (await deps.github.listVariables()).DEPLOY_ENABLED !== "true") {
    await deps.github.setVariable("DEPLOY_ENABLED", "true");
    deps.log("DEPLOY_ENABLED=true: every merge into the default branch now deploys the Products in DEPLOY_PRODUCTS.");
  } else if (enableDeploy && !report.ok) {
    deps.log("DEPLOY_ENABLED stays off: fix what the doctor lists as missing and run this command again.");
  }
  return report.ok ? 0 : 1;
}

const ProductFile = z.object({ id: z.string(), title: z.string(), emailFrom: z.string(), domain: z.string() });

/** Imports `apps/<id>/product.config.ts` (data only, as ticket 07 requires). */
export async function loadProduct(id: string): Promise<ProductIdentity> {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`"${id}" is not a Product id (lower-case, dashes).`);
  const file = resolve(import.meta.dirname, "../../../apps", id, "product.config.ts");
  if (!existsSync(file)) throw new Error(`No Product at apps/${id}/product.config.ts`);
  const parsed = ProductFile.safeParse((await import(pathToFileURL(file).href)).default);
  if (!parsed.success) throw new Error(`apps/${id}/product.config.ts does not export a valid Product: ${parsed.error.message}`);
  return parsed.data;
}

if (import.meta.main) {
  const env = process.env;
  // Every Neon session opened by this process: a Ctrl+C (clack exits the process at once) must still log out and
  // delete the throwaway login folder, so the cleanup also runs on `exit`, synchronously.
  const openNeon = new Set<NeonCli>();
  process.on("exit", () => openNeon.forEach((client) => client.closeSync()));
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));
  try {
    process.exitCode = await runBootstrap(process.argv.slice(2), {
      github: new GhCli(),
      cloudflare: (token) => new CloudflareApi(token),
      neon: (options) => {
        const client = new NeonCli({ ...options, env });
        openNeon.add(client);
        return client;
      },
      accounts: new SkeletonAccounts(),
      resend: (key) => new ResendApi(key),
      product: loadProduct,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      prompter: clackPrompter,
      env,
      log: (line) => console.log(line),
      config: loadConfig(env),
      interactive: Boolean(process.stdin.isTTY),
    });
  } catch (error) {
    console.error(`bootstrap: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
