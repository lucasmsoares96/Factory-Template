import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { BASE_ENV, pick } from "../../env.ts";
import type { RunLogs, RunMatch, RunRef } from "../../commands/retro.ts";
import { GitHubApi, type GitHubApiOptions } from "./api.ts";

/** The Factory workflows whose runs leave a `work-out` artifact with the session streams. */
const WORKFLOWS = ["factory-issue.yml", "factory-pr-feedback.yml", "factory-update-branches.yml"];
const ARTIFACT = "work-out";

const runRow = z.object({
  id: z.number().int(),
  html_url: z.string(),
  display_title: z.string(),
  created_at: z.string(),
});
const runsPage = z.object({ workflow_runs: z.array(runRow) });

/** Runs `gh <args>` with `env` added to the base environment; throws with gh's message on failure. */
export type GhRun = (args: string[], env: Record<string, string>) => Promise<void>;

const runGh: GhRun = (args, env) =>
  new Promise((resolve, reject) => {
    execFile("gh", args, { env: { ...pick(process.env, BASE_ENV), ...env }, maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve();
    });
  });

/**
 * The runs of an issue on GitHub Actions and their `work-out` artifacts. A run belongs to the issue when its title
 * names it: `#N …` (the `run-name` of the Factory workflows), or the issue's or the PR's title (runs started by an
 * issue or review event before `run-name` existed). Only the latest 100 runs of each workflow are looked at.
 */
export class GitHubRunLogs implements RunLogs {
  private readonly api: GitHubApi;
  private readonly options: GitHubApiOptions;
  private readonly gh: GhRun;

  constructor(options: GitHubApiOptions & { gh?: GhRun }) {
    this.options = options;
    this.api = new GitHubApi(options);
    this.gh = options.gh ?? runGh;
  }

  async find(match: RunMatch): Promise<RunRef[]> {
    const found: RunRef[] = [];
    for (const workflow of WORKFLOWS) {
      const page = await this.api.getOrNull(this.api.repoPath(`/actions/workflows/${workflow}/runs?per_page=100`), runsPage);
      for (const run of page?.workflow_runs ?? []) {
        if (belongs(run.display_title, match)) {
          found.push({ id: run.id, url: run.html_url, workflow, title: run.display_title, createdAt: run.created_at });
        }
      }
    }
    return found.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async download(run: RunRef, dir: string): Promise<string[]> {
    try {
      await this.gh(["run", "download", String(run.id), "--repo", this.options.repo, "--name", ARTIFACT, "--dir", dir], { GH_TOKEN: this.options.token });
    } catch {
      // Expired (14 days) or never uploaded: the run's record is gone, the Retro works with the rest.
      return [];
    }
    return listFiles(dir);
  }
}

/** Whether a run title names the issue or its PR. */
export function belongs(title: string, match: RunMatch): boolean {
  const refs = [match.issue, ...(match.pr ? [match.pr] : [])];
  if (refs.some((n) => new RegExp(`(^|\\s)#${n}(\\s|:|$)`).test(title))) return true;
  return match.titles.includes(title);
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name))).sort();
}
