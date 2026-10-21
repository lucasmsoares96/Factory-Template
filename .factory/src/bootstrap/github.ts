import { execFile } from "node:child_process";
import { z } from "zod";
import type { CollaboratorPermission, GitHubClient, LabelSpec, RepoInfo, RulesetInfo, RulesetSpec } from "./clients.ts";

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

  async listSecrets(options: { environment?: string } = {}): Promise<string[]> {
    const rows = JSON.parse(await this.gh(["secret", "list", "--json", "name", ...envFlag(options)])) as { name: string }[];
    return rows.map((r) => r.name);
  }

  async setSecret(name: string, value: string, options: { environment?: string } = {}): Promise<void> {
    await this.gh(["secret", "set", name, ...envFlag(options)], value);
  }

  async listVariables(): Promise<Record<string, string>> {
    const rows = JSON.parse(await this.gh(["variable", "list", "--json", "name,value"])) as { name: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.name, r.value]));
  }

  async setVariable(name: string, value: string): Promise<void> {
    await this.gh(["variable", "set", name, "--body", value]);
  }

  async inviteCollaborator(login: string): Promise<void> {
    // 201 with an invitation, or 204 when the user already is a collaborator; `push` is the API's name for `write`.
    await this.gh(["api", "-X", "PUT", `repos/{owner}/{repo}/collaborators/${encodeURIComponent(login)}`, "--input", "-"], JSON.stringify({ permission: "push" }));
  }

  async collaboratorPermission(login: string): Promise<CollaboratorPermission> {
    try {
      const role = (await this.gh(["api", `repos/{owner}/{repo}/collaborators/${encodeURIComponent(login)}/permission`, "--jq", ".role_name"])).trim();
      return (["admin", "maintain", "write", "triage", "read"] as const).find((r) => r === role) ?? "none";
    } catch (error) {
      if (isRefusal(error)) return "none";
      throw error;
    }
  }

  async listLabels(): Promise<LabelSpec[]> {
    const rows = JSON.parse(await this.gh(["label", "list", "--json", "name,color,description", "--limit", "500"])) as LabelSpec[];
    return rows.map(({ name, color, description }) => ({ name, color: color.toLowerCase(), description: description ?? "" }));
  }

  async upsertLabel(label: LabelSpec): Promise<void> {
    await this.gh(["label", "create", label.name, "--color", label.color, "--description", label.description, "--force"]);
  }

  async listEnvironments(): Promise<string[]> {
    try {
      return environments.parse(JSON.parse(await this.gh(["api", "repos/{owner}/{repo}/environments?per_page=100"]))).environments.map((e) => e.name);
    } catch (error) {
      // Where environments do not exist (private repo on Free) there is none to list.
      if (isRefusal(error)) return [];
      throw error;
    }
  }

  async upsertEnvironment(name: string, input: { branch: string }): Promise<"created" | "refused"> {
    try {
      const base = `repos/{owner}/{repo}/environments/${encodeURIComponent(name)}`;
      await this.gh(["api", "-X", "PUT", base, "--input", "-"], JSON.stringify({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }));
      const policies = branchPolicies.parse(JSON.parse(await this.gh(["api", `${base}/deployment-branch-policies`])));
      if (!policies.branch_policies.some((p) => p.name === input.branch)) {
        await this.gh(["api", "-X", "POST", `${base}/deployment-branch-policies`, "--input", "-"], JSON.stringify({ name: input.branch, type: "branch" }));
      }
      return "created";
    } catch (error) {
      if (isRefusal(error)) return "refused";
      throw error;
    }
  }

  async listRulesets(): Promise<RulesetInfo[]> {
    try {
      const summaries = rulesetList.parse(JSON.parse(await this.gh(["api", "repos/{owner}/{repo}/rulesets?includes_parents=false"])));
      const detailed: RulesetInfo[] = [];
      for (const { id } of summaries) {
        const r = ruleset.parse(JSON.parse(await this.gh(["api", `repos/{owner}/{repo}/rulesets/${id}`])));
        detailed.push({
          id: r.id,
          name: r.name,
          target: r.target,
          enforcement: r.enforcement,
          include: r.conditions?.ref_name?.include ?? [],
          rules: r.rules.map((rule) => rule.type),
          requiredChecks: r.rules.flatMap((rule) => rule.parameters?.required_status_checks?.map((c) => c.context) ?? []),
        });
      }
      return detailed;
    } catch (error) {
      // Where rulesets do not exist (private repo on Free) there is nothing to list.
      if (isRefusal(error)) return [];
      throw error;
    }
  }

  async createRuleset(spec: RulesetSpec): Promise<"created" | "refused"> {
    const rules = spec.rules.map((type) => {
      if (type === "pull_request") {
        return { type, parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } };
      }
      if (type === "required_status_checks") {
        return { type, parameters: { strict_required_status_checks_policy: false, required_status_checks: spec.requiredChecks.map((context) => ({ context })) } };
      }
      return { type };
    });
    const body = {
      name: spec.name,
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: spec.include, exclude: [] } },
      // Repository admins may bypass (role id 5), so a broken check never locks the owner out.
      bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
      rules,
    };
    try {
      await this.gh(["api", "-X", "POST", "repos/{owner}/{repo}/rulesets", "--input", "-"], JSON.stringify(body));
      return "created";
    } catch (error) {
      if (isRefusal(error)) return "refused";
      throw error;
    }
  }
}

const envFlag = (options: { environment?: string }) => (options.environment ? ["--env", options.environment] : []);

/** The API says the plan or visibility does not allow it: 403 (upgrade required), 404 or 422. */
function isRefusal(error: unknown): boolean {
  return /HTTP (403|404|422)/.test((error as Error).message);
}

const environments = z.object({ environments: z.array(z.object({ name: z.string() })) });
const branchPolicies = z.object({ branch_policies: z.array(z.object({ name: z.string() })) });
const rulesetList = z.array(z.object({ id: z.number() }));
const ruleset = z.object({
  id: z.number(),
  name: z.string(),
  target: z.string(),
  enforcement: z.string(),
  conditions: z.object({ ref_name: z.object({ include: z.array(z.string()) }).optional() }).nullish(),
  rules: z.array(
    z.object({
      type: z.string(),
      parameters: z.object({ required_status_checks: z.array(z.object({ context: z.string() })).optional() }).nullish(),
    }),
  ),
});
