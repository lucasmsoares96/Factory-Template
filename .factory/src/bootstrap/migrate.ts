import { legacyEnvironment, PREVIEW_ENVIRONMENT, PRODUCTION_ENVIRONMENT, REPO_SECRETS, STAGE_ENVIRONMENTS } from "./environments.ts";
import { USE_ENVIRONMENTS } from "./product.ts";
import type { StepContext } from "./steps.ts";

/** What the old layout left behind: environments per Product and deploy secrets at repo level. */
export interface LegacyLayout {
  /** Deploy secrets of the repository (everything but the Factory's own tokens and the CI-only Stripe key). */
  repoSecrets: string[];
  /** The `<id>-production` and `<id>-preview` environments, with the names of the secrets they hold. */
  environments: { name: string; stage: string; secrets: string[] }[];
}

/**
 * Looks for the old layout. With `FACTORY_USE_ENVIRONMENTS=false` the repo is where the deploy secrets are meant to live,
 * so nothing is left behind (and the per-Product environments, if any, are not read).
 */
export async function legacyLayout(ctx: StepContext): Promise<LegacyLayout> {
  if ((await ctx.github.listVariables())[USE_ENVIRONMENTS] === "false") return { repoSecrets: [], environments: [] };
  const repoSecrets = (await ctx.github.listSecrets()).filter((name) => !REPO_SECRETS.includes(name)).sort();
  const environments = [];
  for (const name of (await ctx.github.listEnvironments()).sort()) {
    const legacy = legacyEnvironment(name);
    if (legacy) environments.push({ name, stage: legacy.stage, secrets: (await ctx.github.listSecrets({ environment: name })).sort() });
  }
  return { repoSecrets, environments };
}

/** How to move to the stage environments; the text of the doctor's warnings. */
export const MIGRATE_HINT = `run \`pnpm bootstrap\` and \`pnpm bootstrap product <id>\` for each Product (they copy what can be made again and ask the rest once), run the Deploy workflow, then \`pnpm bootstrap migrate-environments\` deletes the old ones`;

/**
 * `pnpm bootstrap migrate-environments`: the last step of the move to the `production` and `preview` environments. A secret
 * cannot be read back from GitHub, so the copy is the rerun of the bootstrap; this deletes what that left behind, and only
 * what a copy exists for, after listing it and a confirmation. Returns the exit code.
 */
export async function migrateEnvironments(ctx: StepContext): Promise<number> {
  const layout = await legacyLayout(ctx);
  if (layout.repoSecrets.length === 0 && layout.environments.length === 0) {
    ctx.log("Nothing to migrate: no per-Product environment and no deploy secret at repo level.");
    return 0;
  }
  const existing = await ctx.github.listEnvironments();
  const held = new Map<string, string[]>();
  for (const stage of STAGE_ENVIRONMENTS) held.set(stage, existing.includes(stage) ? await ctx.github.listSecrets({ environment: stage }) : []);

  // Nothing is deleted whose copy is not in place: a secret cannot be read back, so deleting it first could not be undone.
  const uncopied: string[] = [];
  for (const environment of layout.environments) {
    for (const name of environment.secrets) if (!held.get(environment.stage)?.includes(name)) uncopied.push(`${name} (in ${environment.name}, not in ${environment.stage})`);
  }
  for (const name of layout.repoSecrets) {
    // Cloudflare goes to both stages; a preview secret (`<ID>_PREVIEW_...`) to `preview`; the rest to `production`.
    const stages = name.startsWith("CLOUDFLARE_") ? STAGE_ENVIRONMENTS : name.includes("_PREVIEW_") ? [PREVIEW_ENVIRONMENT] : [PRODUCTION_ENVIRONMENT];
    const needed = stages.filter((stage) => !held.get(stage)?.includes(name));
    if (needed.length > 0) uncopied.push(`${name} (at repo level, not in ${needed.join(" and ")})`);
  }
  if (uncopied.length > 0) {
    ctx.log(`Not deleted: these have no copy in ${PRODUCTION_ENVIRONMENT} / ${PREVIEW_ENVIRONMENT} yet:\n${uncopied.map((u) => `  - ${u}`).join("\n")}\nCopy them first: ${MIGRATE_HINT}.`);
    return 1;
  }

  ctx.log("\nThis will be deleted, for good (a GitHub secret cannot be read back):\n");
  for (const environment of layout.environments) ctx.log(`  - environment ${environment.name}${environment.secrets.length > 0 ? `, with its secrets ${environment.secrets.join(", ")}` : ""}`);
  for (const name of layout.repoSecrets) ctx.log(`  - repo secret ${name}`);
  ctx.log(`\nOnly do this after the workflows read ${PRODUCTION_ENVIRONMENT} and ${PREVIEW_ENVIRONMENT} and a deploy of the default branch went green.\n`);
  if (!ctx.interactive || !(await ctx.prompter.confirm({ id: "migrate-environments-confirm", message: "A deploy of the default branch was green with the new environments. Delete the old ones?", initial: false }))) {
    ctx.log("Nothing was deleted.");
    return 1;
  }
  for (const environment of layout.environments) {
    await ctx.github.deleteEnvironment(environment.name);
    ctx.log(`deleted environment ${environment.name}`);
  }
  for (const name of layout.repoSecrets) {
    await ctx.github.deleteSecret(name);
    ctx.log(`deleted repo secret ${name}`);
  }
  return 0;
}
