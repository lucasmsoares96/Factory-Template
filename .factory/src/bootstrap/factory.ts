import { labels } from "./common.ts";
import type { CollaboratorPermission } from "./clients.ts";
import type { Step, StepContext } from "./steps.ts";

export const FACTORY_TOKEN = "FACTORY_TOKEN";
export const FACTORY_MACHINE_USER = "FACTORY_MACHINE_USER";
export const FACTORY_ENABLED = "FACTORY_ENABLED";
export const CLAUDE_OAUTH = "CLAUDE_CODE_OAUTH_TOKEN";
export const CLAUDE_KEY = "ANTHROPIC_API_KEY";

const ATTEMPTS = 3;
const CAN_WRITE: CollaboratorPermission[] = ["write", "maintain", "admin"];

/** The classic-PAT form of GitHub, filled in: only `repo` (never `workflow`, so the Factory cannot edit workflows). */
export const PAT_URL = `https://github.com/settings/tokens/new?scopes=repo&description=${encodeURIComponent("Factory machine user")}`;

/** Why a PAT cannot be the Factory's identity, or null when it can. Reads the token with `GET /user` only. */
async function problem(ctx: StepContext, pat: string): Promise<{ problem: string | null; login?: string }> {
  let viewer: { login: string; scopes: string[] | null };
  try {
    viewer = await ctx.machine(pat).viewer();
  } catch (error) {
    return { problem: `The PAT is not valid: ${(error as Error).message}` };
  }
  const { login, scopes } = viewer;
  if (scopes === null) return { problem: "That is not a classic PAT (GitHub sent no X-OAuth-Scopes): create a classic one, a fine-grained token cannot attach the prints to the evidence comment.", login };
  if (!scopes.includes("repo")) return { problem: `The PAT lacks the \`repo\` scope (it has: ${scopes.join(", ") || "none"}).`, login };
  if (scopes.includes("workflow")) return { problem: "The PAT has the `workflow` scope: remove it, so the Factory can never change a workflow file.", login };
  const owner = (await ctx.github.repo()).fullName.split("/")[0]!;
  if (login.toLowerCase() === owner.toLowerCase()) return { problem: `The PAT belongs to ${login}, the repository's owner: the Factory must write as its own account, not as its owner.`, login };
  if (login.toLowerCase() === (await ctx.github.user()).toLowerCase()) return { problem: `The PAT belongs to ${login}, the same login as your own \`gh\` session: use a separate machine user account.`, login };
  return { problem: null, login };
}

/** The only prompt of the module: the machine user's classic PAT. It goes straight to the `FACTORY_TOKEN` secret. */
export const machineUser: Step = {
  id: "machine-user",
  title: `Machine user (${FACTORY_TOKEN}, ${FACTORY_MACHINE_USER})`,
  async check(ctx) {
    const [secrets, variables] = await Promise.all([ctx.github.listSecrets(), ctx.github.listVariables()]);
    const login = variables[FACTORY_MACHINE_USER];
    return { done: secrets.includes(FACTORY_TOKEN) && Boolean(login), detail: login };
  },
  async run(ctx) {
    for (let attempt = 1; ; attempt++) {
      if (attempt === 1) {
        ctx.log("The Factory writes as a machine user: a separate GitHub account that only this repository invites.");
        ctx.prompter.link("Signed in as that account, create a classic personal access token with the `repo` scope only (if the form opens empty, tick `repo` by hand and leave `workflow` unticked):", PAT_URL);
      }
      const pat = (ctx.env[FACTORY_TOKEN] || (await ctx.prompter.password({ id: "factory-pat", message: "Paste the machine user's classic PAT" }))).trim();
      const checked = await problem(ctx, pat);
      if (checked.problem === null) {
        // The token is checked: it goes to the forge's secret now and nowhere else.
        await ctx.github.setVariable(FACTORY_MACHINE_USER, checked.login!);
        await ctx.github.setSecret(FACTORY_TOKEN, pat);
        ctx.memory.factoryPat = pat;
        ctx.memory.machineLogin = checked.login!;
        return;
      }
      if (attempt >= ATTEMPTS) throw new Error(`${checked.problem} Nothing was stored.`);
      ctx.log(`${checked.problem} Nothing was stored; paste another PAT.`);
    }
  },
};

/** The machine user needs `write`: it is invited and accepts the invitation with its own PAT. */
export const machineCollaborator: Step = {
  id: "machine-collaborator",
  title: "Machine user is a write collaborator",
  async check(ctx) {
    const login = ctx.memory.machineLogin ?? (await ctx.github.listVariables())[FACTORY_MACHINE_USER];
    if (!login) return { done: false };
    const permission = await ctx.github.collaboratorPermission(login);
    return { done: CAN_WRITE.includes(permission), detail: `${login}: ${permission}` };
  },
  async run(ctx) {
    const login = ctx.memory.machineLogin ?? (await ctx.github.listVariables())[FACTORY_MACHINE_USER];
    if (!login) throw new Error(`No ${FACTORY_MACHINE_USER}: run this command again.`);
    const repo = (await ctx.github.repo()).fullName;
    await ctx.github.inviteCollaborator(login);
    const pat = ctx.memory.factoryPat;
    if (pat && (await ctx.machine(pat).acceptInvitation(repo))) return;
    throw new Error(`${login} has not accepted the invitation to ${repo}. Sign in as ${login} and accept it at https://github.com/${repo}/invitations, then run this command again.`);
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

/** The Factory module: labels, the machine user, its invitation and Claude's auth. FACTORY_ENABLED is set after the doctor. */
export const factorySteps: Step[] = [labels, machineUser, machineCollaborator, claudeAuth];
