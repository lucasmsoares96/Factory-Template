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
}
