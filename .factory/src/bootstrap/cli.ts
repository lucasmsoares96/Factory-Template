import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { CloudflareApi } from "./cloudflare.ts";
import { commonSteps } from "./common.ts";
import { doctor, formatReport } from "./doctor.ts";
import { GhCli } from "./github.ts";
import { clackPrompter } from "./prompter.ts";
import { domainSteps } from "./domain.ts";
import { ResendApi } from "./resend.ts";
import { NeonCli } from "./services.ts";
import { runSteps, type BootstrapDeps, type ProductIdentity } from "./steps.ts";

export type { BootstrapDeps } from "./steps.ts";

const USAGE = `Usage: pnpm bootstrap [command] [options]

Commands:
  (none)                 Set up the common part: Cloudflare token and account, workers.dev, labels.
                         Looks at the current state and skips what already exists, so it is safe to rerun.
  doctor                 Read-only check of secrets, variables, labels and resources; shows what is switched off.
  domain <id>            Per Product: Resend sending domain, its DNS records in Cloudflare, a restricted
                         Resend key and the Worker's Custom Domain. Skips what exists, so it is safe to rerun.
  help                   Show this message.

Options:
  --redo <step>          Redo one step even if it looks done (repeatable): cloudflare-token, workers-dev, labels;
                         for the domain command: resend-domain, dns-records, restricted-resend-key, worker-domain.

Run \`pnpm bootstrap doctor\` after the wizard and whenever something looks off.
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
    let product: ProductIdentity;
    try {
      product = await deps.product(productId);
    } catch (error) {
      deps.log((error as Error).message);
      return 1;
    }
    if (!product.domain) {
      deps.prompter.note(`apps/${productId}/product.config.ts has no \`domain\`. Set it there (the wizard never rewrites that file); using the answer below for this run only.`);
      product = { ...product, domain: (await deps.prompter.text({ id: "product-domain", message: `Domain of ${productId} (e.g. example.com)` })).trim() };
    }
    await runSteps(domainSteps(product), { ...deps, memory: {} }, values.redo ?? []);
    deps.log(`Domain part done. Run \`pnpm bootstrap doctor ${productId}\` to check it.`);
    return 0;
  }
  if (command === "doctor") {
    const report = await doctor(deps, productId);
    deps.log(formatReport(report));
    return report.ok ? 0 : 1;
  }
  if (command !== undefined) {
    deps.log(`Unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  await runSteps(commonSteps, { ...deps, memory: {} }, values.redo ?? []);
  deps.log("Common part done. Run `pnpm bootstrap doctor` to check it.");
  return 0;
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
  try {
    process.exitCode = await runBootstrap(process.argv.slice(2), {
      github: new GhCli(),
      cloudflare: (token) => new CloudflareApi(token),
      neon: new NeonCli(env),
      resend: (key) => new ResendApi(key),
      product: loadProduct,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      prompter: clackPrompter,
      env,
      log: (line) => console.log(line),
      config: loadConfig(env),
    });
  } catch (error) {
    console.error(`bootstrap: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
