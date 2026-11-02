import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { SecretFinding, SecretScan, SecretScanner } from "../../seams/secret-scanner.ts";

const exec = promisify(execFile);

/** The rules of this repository (`.gitleaks.toml`): the scanner's defaults plus the secrets the Products use, and the exceptions. */
export const GITLEAKS_CONFIG = fileURLToPath(new URL("../../../../.gitleaks.toml", import.meta.url));

/**
 * The real scanner: gitleaks (version pinned in `.factory/image/install-gitleaks.sh`). The commits go through
 * `gitleaks git --log-opts base..head`, the texts through `gitleaks dir`. Always `--redact`, and only the file, line and
 * rule are read from the report. No way to skip a finding but the config's allowlist: `gitleaks:allow` comments and
 * `.gitleaksignore` files (which could come from the branch) are off.
 */
export class GitleaksScanner implements SecretScanner {
  private readonly bin: string;
  private readonly config: string;

  constructor(options: { bin?: string; config?: string } = {}) {
    this.bin = options.bin ?? "gitleaks";
    this.config = options.config ?? GITLEAKS_CONFIG;
  }

  async scan({ repo, base, head, texts }: SecretScan): Promise<SecretFinding[]> {
    const work = await mkdtemp(join(tmpdir(), "factory-gitleaks-"));
    try {
      const findings: SecretFinding[] = [];
      if (head) {
        for (const f of await this.run(work, "git", [`--log-opts=${base}..${head}`, repo])) findings.push(f);
      }
      if (texts.length > 0) {
        const dir = join(work, "texts");
        await mkdir(dir);
        const names = new Map<string, string>();
        for (const [i, { name, text }] of texts.entries()) {
          const file = `text-${i}.txt`;
          names.set(file, name);
          await writeFile(join(dir, file), text);
        }
        for (const f of await this.run(work, "dir", [dir])) findings.push({ ...f, source: names.get(basename(f.source)) ?? f.source });
      }
      return findings;
    } finally {
      await rm(work, { recursive: true, force: true, maxRetries: 3 });
    }
  }

  private async run(work: string, command: "git" | "dir", target: string[]): Promise<SecretFinding[]> {
    const report = join(work, `${command}-report.json`);
    const empty = join(work, "no-ignore");
    await mkdir(empty, { recursive: true });
    const args = [
      command, "--config", this.config, "--redact", "--no-banner", "--no-color", "--log-level", "error",
      "--ignore-gitleaks-allow", "--gitleaks-ignore-path", empty,
      "--report-format", "json", "--report-path", report, ...target,
    ];
    try {
      await exec(this.bin, args, { maxBuffer: 16 * 1024 * 1024 });
      return [];
    } catch (error) {
      // Exit code 1 is "leaks found"; anything else (a missing binary, a bad config) means nothing was scanned.
      const failure = error as { code?: unknown; stderr?: string; message: string };
      if (failure.code !== 1) throw new Error(`gitleaks did not run: ${failure.code === "ENOENT" ? `${this.bin} is not installed` : (failure.stderr ?? failure.message).trim().slice(-500)}`);
    }
    // Exit code 1 without a report is an error too (a bad config): never read it as "no findings".
    const content = await readFile(report, "utf8").catch(() => null);
    if (content === null) throw new Error("gitleaks did not run: it left no report");
    const raw = JSON.parse(content) as { File: string; StartLine: number; RuleID: string }[] | null;
    return (raw ?? []).map((r) => ({ source: r.File, line: r.StartLine, rule: r.RuleID }));
  }
}
