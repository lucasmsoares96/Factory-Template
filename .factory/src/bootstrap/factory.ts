import { MERGE_MODES, variableName, type MergeMode } from "../config.ts";
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

export const MERGE_MODE_VARIABLE = variableName(["mergeMode"]);

const MERGE_MODE_LABELS: Record<MergeMode, string> = {
  human: "human: every Factory pull request waits for you at the Merge Gate (recommended)",
  safe: "safe: the Factory merges a pull request that touches nothing protected, once verify, the preview smoke, every criterion and the last deploy of the default branch are green",
  all: "all: the Factory merges every pull request once those same checks are green, protected files included (its own workflows, guard, prompts and config.ts): nothing waits for you",
};

/** What a person types to choose `all`. */
const ALL_CONFIRMATION = "all";

/**
 * The Merge Mode (ADR 0016): which Factory pull requests `factory-merge.yml` may merge without a person. Asked only while
 * the variable does not exist; `human` is offered first, and is what a run without a terminal sets (or
 * `FACTORY_MERGE_MODE` from the environment, the only way to `all` without a terminal). Choosing `all` at the prompt
 * takes a typed confirmation; without it the mode does not change. Only this step changes it: the `FACTORY_TOKEN`
 * cannot write a variable.
 */
export const mergeMode: Step = {
  id: "merge-mode",
  title: `Merge Mode (${MERGE_MODE_VARIABLE})`,
  async check(ctx) {
    const value = (await ctx.github.listVariables())[MERGE_MODE_VARIABLE];
    return { done: value !== undefined, detail: value };
  },
  async run(ctx) {
    const fromEnv = ctx.env[MERGE_MODE_VARIABLE]?.trim();
    if (fromEnv && !(MERGE_MODES as readonly string[]).includes(fromEnv)) throw new Error(`${MERGE_MODE_VARIABLE}=${fromEnv} is not one of ${MERGE_MODES.join(", ")}. Nothing was stored.`);
    if (fromEnv) return ctx.github.setVariable(MERGE_MODE_VARIABLE, fromEnv);
    if (!ctx.interactive) return ctx.github.setVariable(MERGE_MODE_VARIABLE, "human");
    const value = await ctx.prompter.select<MergeMode>({
      id: "merge-mode",
      message: "Which Factory pull requests may be merged without you? A merge into the default branch deploys to production.",
      options: MERGE_MODES.map((value) => ({ value, label: MERGE_MODE_LABELS[value] })),
    });
    if (value === "all") {
      const typed = (
        await ctx.prompter.text({
          id: "merge-mode-confirm",
          message: `In all, the Factory can merge changes to its own rules (workflows, guard, prompts, config.ts) and nothing requires a human review. Type "${ALL_CONFIRMATION}" to confirm`,
        })
      ).trim();
      if (typed !== ALL_CONFIRMATION) {
        ctx.log(`"${typed}" is not "${ALL_CONFIRMATION}". The Merge Mode is unchanged.`);
        return;
      }
    }
    await ctx.github.setVariable(MERGE_MODE_VARIABLE, value);
  },
};

/** The Factory module: labels, the Factory token, Claude's auth, auto-merge and the Merge Mode. FACTORY_ENABLED is set after the doctor. */
export const factorySteps: Step[] = [labels, factoryToken, claudeAuth, autoMerge, mergeMode];
