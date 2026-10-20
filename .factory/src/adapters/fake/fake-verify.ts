import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Verify, VerifyRun } from "../../seams/verify.ts";

export interface VerifyStep extends Partial<VerifyRun> {
  /** Prints the `@evidence` tests would write, by Product. */
  evidence?: { product: string; name: string }[];
}

/**
 * Scripted Verify. Each run consumes the next step and writes its evidence
 * into `<cwd>/<evidenceDir>/<product>/<name>`, like the real E2E does.
 */
export class FakeVerify implements Verify {
  runs = 0;
  private readonly cwd: string;
  private readonly evidenceDir: string;
  private readonly steps: VerifyStep[];

  constructor(cwd: string, evidenceDir: string, steps: VerifyStep[]) {
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
}
