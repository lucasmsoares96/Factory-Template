import { labels } from "./common.ts";
import type { Step, StepContext } from "./steps.ts";

export const FACTORY_TOKEN = "FACTORY_TOKEN";
export const FACTORY_ENABLED = "FACTORY_ENABLED";
export const CLAUDE_OAUTH = "CLAUDE_CODE_OAUTH_TOKEN";
export const CLAUDE_KEY = "ANTHROPIC_API_KEY";

const ATTEMPTS = 3;

/**
 * The fine-grained token form of GitHub, pre-filled (docs checked 2026-10-21): name, description, owner, no expiry and
 * the four permissions the Factory needs. The form has no parameter to pick repositories. `workflows` is in: GitHub
 * refuses a push that changes `.github/workflows/` without it, and the Factory may change workflow files (ADR 0012).
 */
export function tokenUrl(repoFullName: string): string {
  const [owner, name] = repoFullName.split("/") as [string, string];
  const query = new URLSearchParams({
    name: `Factory ${name}`,
    description: `Factory for ${repoFullName}: opens pull requests and comments on issues.`,
    target_name: owner,
    expires_in: "none",
    contents: "write",
    pull_requests: "write",
    issues: "write",
    workflows: "write",
  });
  return `https://github.com/settings/personal-access-tokens/new?${query}`;
}

/** Why a token cannot be the Factory's identity, or null when it can. The token never leaves memory except to GitHub. */
async function problem(ctx: StepContext, token: string, repo: string): Promise<string | null> {
  if (token.startsWith("ghp_")) return "That is a classic token (ghp_): a classic token reaches every repository you own. Create a fine-grained one (github_pat_), limited to this repository.";
  if (!token.startsWith("github_pat_")) return "That is not a fine-grained personal access token: it must start with github_pat_.";
  let access: { push: boolean };
  try {
    access = await ctx.token(token).repoAccess(repo);
  } catch (error) {
    return (error as Error).message;
  }
  if (!access.push) return `The token cannot write to ${repo}: give it Contents, Pull requests and Issues as Read and write.`;
  return null;
}

/**
 * The only prompt of the module: the owner's fine-grained token. It goes straight to the `FACTORY_TOKEN` secret. The
 * Factory writes as the owner (so it recognises its own texts by a hidden marker, not by the author).
 */
export const factoryToken: Step = {
  id: "factory-token",
  title: `Factory token (${FACTORY_TOKEN})`,
  async check(ctx) {
    return { done: (await ctx.github.listSecrets()).includes(FACTORY_TOKEN) };
  },
  async run(ctx) {
    const repo = (await ctx.github.repo()).fullName;
    const fromEnv = ctx.env[FACTORY_TOKEN]?.trim();
    if (!fromEnv) {
      ctx.log("The Factory writes as you, with a fine-grained token of yours limited to this repository. The one manual step on the form: under Repository access choose \"Only select repositories\" and pick this repository.");
      ctx.prompter.link("Open the form (everything else is filled in):", tokenUrl(repo));
    }
    for (let attempt = 1; ; attempt++) {
      const token = (fromEnv || (await ctx.prompter.password({ id: "factory-token", message: "Paste the fine-grained token" }))).trim();
      const refused = await problem(ctx, token, repo);
      if (refused === null) {
        await ctx.github.setSecret(FACTORY_TOKEN, token);
        // GitHub offers no way to read the permissions of a fine-grained token (checked 2026-10-21), so this cannot be tested.
        ctx.log("Stored. GitHub cannot tell whether the token has the Workflows permission: without it, a Factory pull request that changes a workflow file fails to push.");
        return;
      }
      if (fromEnv || attempt >= ATTEMPTS) throw new Error(`${refused} Nothing was stored.`);
      ctx.log(`${refused} Nothing was stored; paste another token.`);
    }
  },
};

/** Claude's auth is taken from the environment or an existing secret, never asked: a pasted token would be a second prompt. */
export const claudeAuth: Step = {
  id: "claude-auth",
  title: `Claude auth (${CLAUDE_OAUTH} or ${CLAUDE_KEY})`,
  async check(ctx) {
    const secrets = await ctx.github.listSecrets();
    const have = [CLAUDE_OAUTH, CLAUDE_KEY].filter((name) => secrets.includes(name));
    if (have.length === 2) return { done: true, detail: `warning: both exist, ${CLAUDE_KEY} wins; delete one` };
    return { done: have.length === 1, detail: have[0] };
  },
  async run(ctx) {
    const oauth = ctx.env[CLAUDE_OAUTH];
    const key = ctx.env[CLAUDE_KEY];
    if (oauth) {
      await ctx.github.setSecret(CLAUDE_OAUTH, oauth);
      if (key) ctx.log(`${CLAUDE_KEY} is also set in the environment and was not stored: ${CLAUDE_OAUTH} is the recommended one, and ${CLAUDE_KEY} would win over it.`);
      return;
    }
    if (key) {
      await ctx.github.setSecret(CLAUDE_KEY, key);
      return;
    }
    ctx.log(
      `No Claude auth yet. Run \`claude setup-token\` (a Claude subscription; recommended) and export the result as ${CLAUDE_OAUTH}, ` +
        `or export ${CLAUDE_KEY}, then run \`pnpm bootstrap factory\` again. The value goes straight to the repo secret.`,
    );
  },
};

/**
 * The repo lets a pull request merge itself once `verify` is green: the skills update (`factory-skills-update.yml`,
 * ADR 0013) relies on it to take upstream skills with no one looking. The Factory's own pull requests never turn it on.
 */
export const autoMerge: Step = {
  id: "auto-merge",
  title: "Auto-merge allowed (for the skills update)",
  async check(ctx) {
    return { done: await ctx.github.autoMergeAllowed() };
  },
  async run(ctx) {
    await ctx.github.allowAutoMerge();
  },
};

/** The Factory module: labels, the Factory token, Claude's auth and auto-merge. FACTORY_ENABLED is set after the doctor. */
export const factorySteps: Step[] = [labels, factoryToken, claudeAuth, autoMerge];
