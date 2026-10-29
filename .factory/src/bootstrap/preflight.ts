import type { RepoInfo } from "./clients.ts";
import type { BootstrapDeps } from "./steps.ts";

/**
 * The first check of every command, before the repository is chosen and before any step or the doctor: Node and pnpm
 * at the versions `.prototools` pins, `gh` installed and signed in. With a terminal it offers (and confirms before
 * touching anything outside the repo) `proto install gh` and `gh auth login --web`; without one it installs and opens
 * nothing, and lists everything that is missing at once. Returns `false` (after logging why) when the run must stop.
 */
export async function checkTools(deps: BootstrapDeps): Promise<boolean> {
  const { tools, prompter } = deps;
  const problems: string[] = [];

  const pins = await tools.pinned();
  const node = await tools.nodeVersion();
  if (pins.node && node !== pins.node) {
    problems.push(`Node is ${node}, .prototools pins ${pins.node}. Fix: run \`proto install\` in this clone and open a new shell.`);
  }
  if (pins.pnpm) {
    const pnpm = await tools.pnpmVersion();
    if (pnpm !== pins.pnpm) {
      problems.push(`pnpm is ${pnpm ?? "not installed"}, .prototools pins ${pins.pnpm}. Fix: run \`proto install\` in this clone and open a new shell.`);
    }
  }

  if (!(await tools.ghInstalled())) {
    if (deps.interactive && (await prompter.confirm({ id: "install-gh", message: "The GitHub CLI (`gh`) is not installed. Run `proto install gh`?", initial: true }))) {
      await tools.installGh();
    }
    if (!(await tools.ghInstalled())) problems.push("`gh` is not installed. Fix: run `proto install gh`.");
  }
  // Only a `gh` that exists can be asked about its login.
  if (problems.every((p) => !p.startsWith("`gh`")) && !(await tools.ghAuthenticated())) {
    if (deps.interactive && (await prompter.confirm({ id: "login-gh", message: "`gh` is not signed in. Run `gh auth login --web` (opens your browser)?", initial: true }))) {
      await tools.loginGh();
    }
    if (!(await tools.ghAuthenticated())) problems.push("`gh` is not signed in. Fix: run `gh auth login --web`.");
  }

  if (problems.length === 0) return true;
  deps.log(`Missing before the bootstrap can start:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  return false;
}

/** The wizard sets secrets and variables, which GitHub allows to repository admins only; checked once the repository is chosen. */
export function checkAdmin(deps: BootstrapDeps, repo: RepoInfo): boolean {
  if (repo.viewerPermission === "ADMIN") return true;
  deps.log(`Your account has ${repo.viewerPermission.toLowerCase()} access to ${repo.fullName}, and the bootstrap needs admin to set secrets and variables. Ask an admin of the repository, or sign in to \`gh\` with an admin account. Nothing was written.`);
  return false;
}
