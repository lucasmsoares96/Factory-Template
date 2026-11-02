import type { SecretFinding, SecretScan, SecretScanner } from "../../seams/secret-scanner.ts";

/** Scripted scanner: reports `findings` (or what `respond` answers for the scan) for every scan and remembers what it was asked to scan.
 * With `publishOnly` it answers only the scan of `publish`, so one scanner serves both jobs of a pipeline test. */
export class FakeSecretScanner implements SecretScanner {
  readonly scans: SecretScan[] = [];
  private readonly findings: SecretFinding[];
  private readonly publishOnly: boolean;
  private readonly respond: ((input: SecretScan) => SecretFinding[]) | null;
  private readonly failure: Error | null;

  constructor(options: { findings?: SecretFinding[]; failure?: Error; respond?: (input: SecretScan) => SecretFinding[]; publishOnly?: boolean } = {}) {
    this.publishOnly = options.publishOnly ?? false;
    this.respond = options.respond ?? null;
    this.findings = options.findings ?? [];
    this.failure = options.failure ?? null;
  }

  async scan(input: SecretScan): Promise<SecretFinding[]> {
    // `publish` scans the texts of the whole result (named `result.…`); the work job scans a Stage's own texts.
    if (this.publishOnly && !input.texts.some((t) => t.name.startsWith("result."))) return [];
    this.scans.push(input);
    if (this.failure) throw this.failure;
    return this.respond ? this.respond(input) : this.findings;
  }
}
