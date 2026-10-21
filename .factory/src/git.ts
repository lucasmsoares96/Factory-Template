import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Thin wrapper over the `git` CLI in one working directory. */
export class Git {
  readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async run(...args: string[]): Promise<string> {
    const { stdout } = await exec("git", args, { cwd: this.cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  }

  async head(): Promise<string> {
    return (await this.run("rev-parse", "HEAD")).trim();
  }

  async revParse(ref: string): Promise<string> {
    return (await this.run("rev-parse", "--verify", `${ref}^{commit}`)).trim();
  }

  /** Number of commits reachable from `to` and not from `from`. */
  async countCommits(from: string, to: string): Promise<number> {
    return Number((await this.run("rev-list", "--count", `${from}..${to}`)).trim());
  }

  async log(from: string, to: string): Promise<string> {
    return (await this.run("log", "--format=%h %s", `${from}..${to}`)).trim();
  }

  /**
   * Files that conflict when `b` is merged into `a` (`git merge-tree --write-tree`, nothing touches the working
   * tree); empty when the merge is clean.
   */
  async mergeConflicts(a: string, b: string): Promise<string[]> {
    try {
      await this.run("merge-tree", "--write-tree", "--name-only", "--no-messages", a, b);
      return [];
    } catch (error) {
      const failure = error as { code?: number; stdout?: string };
      if (failure.code !== 1) throw error;
      const files = (failure.stdout ?? "").split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
      return [...new Set(files.filter((l) => !/^(CONFLICT|Auto-merging)\b/.test(l)))];
    }
  }
}
