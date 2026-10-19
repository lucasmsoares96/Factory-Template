/**
 * Verify seam: the deterministic E2E Stage.
 * Adapters: fake, `pnpm factory:verify` (ticket 10).
 */

export interface VerifyRun {
  ok: boolean;
  /** The command that failed, when `ok` is false. */
  failedCommand: string | null;
  output: string;
}

export interface Verify {
  run(options: { timeoutMs: number }): Promise<VerifyRun>;
}
