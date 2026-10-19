import { execFile } from "node:child_process";
import type { GitHubClient, LabelSpec, RepoInfo } from "./clients.ts";

/** Runs `gh <args>` with optional stdin and returns stdout. */
export type GhExec = (args: string[], input?: string) => Promise<string>;

export const runGh: GhExec = (args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile("gh", args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return reject(new Error("The GitHub CLI (`gh`) is required and was not found. Install it from https://cli.github.com and run `gh auth login`."));
      }
      reject(new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${stderr.trim() || error.message}`));
    });
    child.stdin?.end(input ?? "");
  });

/**
 * The only module that calls `gh`. The repo is the one of the current
 * directory (`gh` reads the git remote), so nothing is hard-coded. Secret
 * values travel through stdin, never through the arguments.
 */
export class GhCli implements GitHubClient {
  private readonly gh: GhExec;

  constructor(gh: GhExec = runGh) {
    this.gh = gh;
  }

  async repo(): Promise<RepoInfo> {
    const raw = JSON.parse(await this.gh(["repo", "view", "--json", "nameWithOwner,visibility,viewerPermission,defaultBranchRef"]));
    return {
      fullName: raw.nameWithOwner,
      visibility: String(raw.visibility).toLowerCase() as RepoInfo["visibility"],
      viewerPermission: raw.viewerPermission,
      defaultBranch: raw.defaultBranchRef?.name ?? "main",
    };
  }

  async user(): Promise<string> {
    return (await this.gh(["api", "user", "--jq", ".login"])).trim();
  }

  async listSecrets(): Promise<string[]> {
    const rows = JSON.parse(await this.gh(["secret", "list", "--json", "name"])) as { name: string }[];
    return rows.map((r) => r.name);
  }

  async setSecret(name: string, value: string): Promise<void> {
    await this.gh(["secret", "set", name], value);
  }

  async listVariables(): Promise<Record<string, string>> {
    const rows = JSON.parse(await this.gh(["variable", "list", "--json", "name,value"])) as { name: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.name, r.value]));
  }

  async setVariable(name: string, value: string): Promise<void> {
    await this.gh(["variable", "set", name, "--body", value]);
  }

  async listLabels(): Promise<LabelSpec[]> {
    const rows = JSON.parse(await this.gh(["label", "list", "--json", "name,color,description", "--limit", "500"])) as LabelSpec[];
    return rows.map(({ name, color, description }) => ({ name, color: color.toLowerCase(), description: description ?? "" }));
  }

  async upsertLabel(label: LabelSpec): Promise<void> {
    await this.gh(["label", "create", label.name, "--color", label.color, "--description", label.description, "--force"]);
  }
}
