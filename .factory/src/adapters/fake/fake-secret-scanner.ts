import type { SecretFinding, SecretScan, SecretScanner } from "../../seams/secret-scanner.ts";

/** Scripted scanner: reports `findings` for every scan and remembers what it was asked to scan. */
export class FakeSecretScanner implements SecretScanner {
  readonly scans: SecretScan[] = [];
  private readonly findings: SecretFinding[];
  private readonly failure: Error | null;

  constructor(options: { findings?: SecretFinding[]; failure?: Error } = {}) {
    this.findings = options.findings ?? [];
    this.failure = options.failure ?? null;
  }

  async scan(input: SecretScan): Promise<SecretFinding[]> {
    this.scans.push(input);
    if (this.failure) throw this.failure;
    return this.findings;
  }
}
