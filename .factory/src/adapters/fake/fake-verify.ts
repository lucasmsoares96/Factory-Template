import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Verify, VerifyRun } from "../../seams/verify.ts";

export interface VerifyStep extends Partial<VerifyRun> {
  /** Prints the `@evidence` tests would write, by Product. */
  evidence?: { product: string; name: string }[];
}

export interface SkeletonCheckStep extends Partial<VerifyRun> {
  /** Files the regeneration writes into the worktree (the lockfile, generated files), by path. */
  writes?: Record<string, string>;
}

/**
 * Scripted Verify. Each run consumes the next step and writes its evidence
 * into `<cwd>/<evidenceDir>/<product>/<name>`, like the real E2E does.
 */
export class FakeVerify implements Verify {
  runs = 0;
  /** Directories `checkSkeleton` ran in. */
  skeletonChecks: string[] = [];
  private readonly cwd: string;
  private readonly evidenceDir: string;
  private readonly steps: VerifyStep[];
  private readonly checks: SkeletonCheckStep[];

  /** `checks` script `checkSkeleton`; one left over is repeated, none at all means it passes and writes nothing. */
  constructor(cwd: string, evidenceDir: string, steps: VerifyStep[], checks: SkeletonCheckStep[] = []) {
    this.checks = [...checks];
    this.cwd = cwd;
    this.evidenceDir = evidenceDir;
    this.steps = [...steps];
  }

  async run(): Promise<VerifyRun> {
    this.runs++;
    const step = this.steps.shift();
    if (!step) throw new Error(`FakeVerify: unscripted run #${this.runs}`);
    for (const shot of step.evidence ?? []) {
      const dir = join(this.cwd, this.evidenceDir, shot.product);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, shot.name), `png:${shot.product}/${shot.name}`);
    }
    const timedOut = step.timedOut ?? false;
    return { ok: !timedOut && (step.ok ?? true), failedCommand: step.failedCommand ?? null, output: step.output ?? "", timedOut };
  }

  async checkSkeleton({ dir }: { dir: string; timeoutMs: number }): Promise<VerifyRun> {
    this.skeletonChecks.push(dir);
    const step = this.checks.length > 1 ? this.checks.shift()! : (this.checks[0] ?? {});
    for (const [path, content] of Object.entries(step.writes ?? {})) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
    const timedOut = step.timedOut ?? false;
    return { ok: !timedOut && (step.ok ?? true), failedCommand: step.failedCommand ?? null, output: step.output ?? "", timedOut };
  }
}
