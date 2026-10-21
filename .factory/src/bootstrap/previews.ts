import { cloudflareHandle, productSecretName } from "./domain.ts";
import { ensureProject, environmentStep, neonHandle, parseProductList } from "./product.ts";
import type { ProductIdentity, Step, StepContext } from "./steps.ts";

export const PREVIEW_PRODUCTS = "PREVIEW_PRODUCTS";
export const PREVIEWS_ENABLED = "PREVIEWS_ENABLED";
/** The default branch of the preview project: the one every `preview/pr-N` branch starts from. */
export const BASE_BRANCH = "base";

/** The environment that holds a Product's preview secrets (restricted like production, with the same repo-level fallback). */
export function previewEnvironment(productId: string): string {
  return `${productId}-preview`;
}

/**
 * What the preview deploy reads for a Product, all with the `<ID>_` prefix. Only the key is a secret: the project id and
 * the KV id are identifiers, kept as variables.
 */
export function previewNames(productId: string) {
  return {
    /** Secret: a Neon API key limited to the `<id>-preview` project (it creates and deletes the PR branches). */
    neonKey: productSecretName(productId, "PREVIEW_NEON_API_KEY"),
    /** Variable: id of the `<id>-preview` Neon project. */
    neonProject: productSecretName(productId, "PREVIEW_NEON_PROJECT_ID"),
    /** Variable: id of the preview KV namespace bound as `OAUTH_KV` in every preview. */
    kv: productSecretName(productId, "PREVIEW_OAUTH_KV_ID"),
  };
}

export const previewProjectName = (productId: string) => `${productId}-preview`;
const previewKvTitle = (productId: string) => `${productId}-preview-oauth`;

/** Where the preview secrets live: the `<id>-preview` environment when it exists, otherwise the repo. */
export async function previewScope(ctx: StepContext, productId: string): Promise<{ environment?: string }> {
  const name = previewEnvironment(productId);
  return (await ctx.github.listEnvironments()).includes(name) ? { environment: name } : {};
}

/** Whether a secret is where the preview deploy reads it (the environment, then the repo). */
export async function previewSecretPresent(ctx: StepContext, productId: string, name: string): Promise<boolean> {
  const scope = await previewScope(ctx, productId);
  const have = new Set([...(await ctx.github.listSecrets(scope)), ...(scope.environment ? await ctx.github.listSecrets() : [])]);
  return have.has(name);
}

/** Whether the repo already holds any trace of this Product's previews (so the doctor shows the section without being asked). */
export async function hasPreviewTrace(ctx: StepContext, productId: string, variables: Record<string, string>, secrets: string[]): Promise<boolean> {
  const names = previewNames(productId);
  return (
    parseProductList(variables[PREVIEW_PRODUCTS]).includes(productId) ||
    variables[names.neonProject] !== undefined ||
    variables[names.kv] !== undefined ||
    secrets.includes(names.neonKey) ||
    (await ctx.github.listEnvironments()).includes(previewEnvironment(productId))
  );
}

export function previewEnvironmentStep(product: ProductIdentity): Step {
  return environmentStep({ id: "preview-environment", name: previewEnvironment(product.id), productId: product.id });
}

/**
 * The Neon project `<id>-preview`, whose default branch is `base`. A recorded project id (the variable) proves it exists:
 * a rerun does not look it up, so it never opens the Neon login for it.
 */
export function previewProjectStep(product: ProductIdentity): Step {
  const names = previewNames(product.id);
  const name = previewProjectName(product.id);
  return {
    id: "preview-neon-project",
    title: `Neon project ${name} (default branch ${BASE_BRANCH})`,
    async check(ctx) {
      const recorded = (await ctx.github.listVariables())[names.neonProject];
      return { done: recorded !== undefined, detail: recorded ? `${recorded}, recorded in ${names.neonProject}` : undefined };
    },
    async run(ctx) {
      const neon = await neonHandle(ctx, true);
      if (!neon) return ctx.log("No Neon session: the preview project was not made. Run again, or export NEON_API_KEY.");
      const project = await ensureProject(ctx, neon, name, `the preview database of ${product.id}`);
      // A new project's default branch is `main`: previews branch from `base`, so it is renamed (a project that has it is left alone).
      const current = await neon.defaultBranchName(project.id);
      if (current !== BASE_BRANCH) {
        await neon.renameBranch(project.id, current, BASE_BRANCH);
        ctx.log(`  renamed the default branch ${current} to ${BASE_BRANCH}`);
      }
      ctx.memory.previewProject = { ...ctx.memory.previewProject, [product.id]: project.id };
      await ctx.github.setVariable(names.neonProject, project.id);
    },
  };
}

const NEON_CONSOLE = "https://console.neon.tech";

/**
 * The project-scoped Neon key the preview deploy uses to branch. Minted with the login of this run when Neon allows it
 * (the docs say a first key comes from the Console and are silent on OAuth); when it refuses, the person pastes one
 * (hidden, stored only as the secret); empty skips it, and the answer is remembered for the run.
 */
export function previewNeonKeyStep(product: ProductIdentity): Step {
  const names = previewNames(product.id);
  return {
    id: "preview-neon-key",
    title: `Neon API key limited to ${previewProjectName(product.id)} (${names.neonKey})`,
    async check(ctx) {
      return { done: await previewSecretPresent(ctx, product.id, names.neonKey) };
    },
    async run(ctx) {
      const projectId = ctx.memory.previewProject?.[product.id] ?? (await ctx.github.listVariables())[names.neonProject];
      if (!projectId) return ctx.log("  No preview project yet: the preview-neon-project step must run first.");
      let key: string | undefined;
      const neon = await neonHandle(ctx, true);
      if (neon) {
        try {
          key = await neon.createApiKey(`${product.id}-preview-ci`, projectId);
        } catch (error) {
          ctx.log(`  Neon would not mint the key with this login (${(error as Error).message}).`);
        }
      }
      if (!key) {
        if (ctx.memory.neonKeyDeclined || !ctx.interactive) return ctx.log(`  ${names.neonKey} was not set: ${ctx.interactive ? "skipped earlier in this run" : "no terminal to ask"}. Run this command again with a terminal.`);
        ctx.prompter.link(`Create a project-scoped key in the Neon Console (Organization, Settings, API keys, Create new, scope: Project, project ${previewProjectName(product.id)}):`, NEON_CONSOLE);
        key = (await ctx.prompter.password({ id: "preview-neon-key", message: "Paste the project-scoped Neon API key (hidden; kept only as a secret; leave empty to skip)" })).trim();
        if (!key) {
          ctx.memory.neonKeyDeclined = true;
          return ctx.log(`  No key given: previews stay off until ${names.neonKey} exists.`);
        }
      }
      await ctx.github.setSecret(names.neonKey, key, await previewScope(ctx, product.id));
    },
  };
}

/** The KV namespace for `OAUTH_KV` in previews (a production Worker makes its own at deploy). The recorded id proves it. */
export function previewKvStep(product: ProductIdentity): Step {
  const names = previewNames(product.id);
  return {
    id: "preview-kv",
    title: `KV namespace ${previewKvTitle(product.id)} (${names.kv})`,
    async check(ctx) {
      const recorded = (await ctx.github.listVariables())[names.kv];
      return { done: recorded !== undefined, detail: recorded };
    },
    async run(ctx) {
      const cloudflare = await cloudflareHandle(ctx, true);
      if (!cloudflare) return ctx.log(`  No saved Cloudflare login: the preview KV was not made. Run this command again to do it.`);
      const title = previewKvTitle(product.id);
      const found = await cloudflare.client.findKvNamespace(cloudflare.accountId, title);
      const kv = found ?? (await cloudflare.client.createKvNamespace(cloudflare.accountId, title));
      if (!found) ctx.log(`  created the KV namespace ${title}`);
      await ctx.github.setVariable(names.kv, kv.id);
    },
  };
}

export function previewProductsStep(product: ProductIdentity): Step {
  return {
    id: "preview-products",
    title: `${product.id} in ${PREVIEW_PRODUCTS}`,
    async check(ctx) {
      return { done: parseProductList((await ctx.github.listVariables())[PREVIEW_PRODUCTS]).includes(product.id) };
    },
    async run(ctx) {
      const current = parseProductList((await ctx.github.listVariables())[PREVIEW_PRODUCTS]);
      if (!current.includes(product.id)) await ctx.github.setVariable(PREVIEW_PRODUCTS, [...current, product.id].join(","));
    },
  };
}

/**
 * The Previews module of `pnpm bootstrap previews <id>`. The environment comes first so the secret lands in it. The Neon
 * login is neonctl's own, kept by the CLI: it is asked once per machine, and only when a Neon step has work.
 * `PREVIEWS_ENABLED` is not a step: the command turns it on after the doctor of the Product's previews passes.
 */
export function previewSteps(product: ProductIdentity): Step[] {
  return [previewEnvironmentStep(product), previewProjectStep(product), previewNeonKeyStep(product), previewKvStep(product), previewProductsStep(product)];
}

