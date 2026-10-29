/**
 * Verify seam: the deterministic E2E Stage.
 * Adapters: fake, `pnpm factory:verify` (ticket 10).
 */

export interface VerifyRun {
  ok: boolean;
  /** The command that failed, when `ok` is false. */
  failedCommand: string | null;
  output: string;
  /** The run was stopped at its timeout (then `ok` is false). */
  timedOut: boolean;
}

export interface Verify {
  run(options: { timeoutMs: number }): Promise<VerifyRun>;
  /**
   * Checks a Skeleton change on its own, in a worktree made from the base branch: regenerates the lockfile and the
   * generated files (it may write them into `dir`), then typecheck and lint. Never touches the working copy of the run.
   */
  checkSkeleton(options: { dir: string; timeoutMs: number }): Promise<VerifyRun>;
}
