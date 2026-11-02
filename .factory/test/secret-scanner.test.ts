import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GITLEAKS_CONFIG, GitleaksScanner } from "../src/adapters/gitleaks/gitleaks-scanner.ts";
import { checkout, commitFile, git, tempDir } from "./helpers.ts";

// The real, pinned gitleaks (installed by .factory/image/install-gitleaks.sh, part of the Factory image) against
// fixtures. No gitleaks on PATH fails these tests: a scan that cannot run must never look like a clean one.
// The fake keys are built here so that this file holds no key the scan itself would flag.
const execFileAsync = promisify(execFile);
const STRIPE_KEY = ["sk", "live", "Zq8xK2mPv4Rt7Yw1Nb5Cd9Ef"].join("_");
const STRIPE_WEBHOOK = ["whsec", "Zq8xK2mPv4Rt7Yw1Nb5Cd9Ef"].join("_");
// Built from pieces at run time: this file must not hold a password the scan itself would flag.
const neonUrl = (password: string) => `postgresql://neondb_owner:${password}@ep-cool-sun-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require`;
const NEON_URL = neonUrl(["Zq8xK2", "mPv4Rt"].join(""));
const NEON_NPG_URL = neonUrl(["npg", "Zq8xK2mPv4Rt7Yw1"].join("_"));
const PLACEHOLDER_URL = neonUrl("${DB_PASSWORD}");
const LOCAL_URL = "postgres://postgres@127.0.0.1:5432/postgres";

/** The paths among `files` that git ignores (`git check-ignore` exits 1 when none is). */
async function gitIgnored(root: string, files: string[]): Promise<string[]> {
  if (files.length === 0) return [];
  const child = execFile("git", ["check-ignore", "--stdin", "-z"], { cwd: root, encoding: "utf8" });
  const done = new Promise<string>((resolve, reject) => {
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 || code === 1 ? resolve(out) : reject(new Error(`git check-ignore exited ${code}`))));
  });
  child.stdin?.end(files.join("\0"));
  return (await done).split("\0").filter(Boolean);
}

async function branchWith(files: Record<string, string>): Promise<{ repo: string; base: string; head: string }> {
  const repo = await checkout();
  const base = await git(repo, "rev-parse", "HEAD");
  for (const [path, content] of Object.entries(files)) await commitFile(repo, path, content, `feat: add ${path} #1`);
  return { repo, base, head: await git(repo, "rev-parse", "HEAD") };
}

describe("GitleaksScanner against the real gitleaks", () => {
  const scanner = new GitleaksScanner();

  it("finds a Stripe key in an ordinary file, with its file, line and rule, and never the value", async () => {
    const { repo, base, head } = await branchWith({ "src/pay.ts": `export const a = 1;\nexport const key = "${STRIPE_KEY}";\n` });

    const findings = await scanner.scan({ repo, base, head, texts: [] });

    expect(findings).toContainEqual({ source: "src/pay.ts", line: 2, rule: "stripe-secret-key" });
    expect(JSON.stringify(findings)).not.toContain(STRIPE_KEY.slice(8));
  });

  it("finds a Postgres URL with a password and lets the URL without one through", async () => {
    const { repo, base, head } = await branchWith({
      "src/db.ts": `export const url = "${NEON_URL}";\n`,
      "src/npg.ts": `export const url = "${NEON_NPG_URL}";\n`,
      "src/placeholder.ts": `export const url = "${PLACEHOLDER_URL}";\n`,
      "src/local.ts": `export const url = "${LOCAL_URL}";\nexport const compose = "postgres://postgres:postgres@postgres:5432/postgres";\n`,
    });

    const findings = await scanner.scan({ repo, base, head, texts: [] });

    expect(findings.map((f) => [f.source, f.rule]).sort()).toEqual([["src/db.ts", "postgres-url-with-password"], ["src/npg.ts", "postgres-url-with-password"]]);
  });

  it("finds nothing in this repository: no secret, not even a fake one, is written out in full", async () => {
    const root = join(import.meta.dirname, "..", "..");
    const out = join(await tempDir(), "report.json");

    // The skills come from their source repository (skills-lock.json), not from this one.
    await execFileAsync("gitleaks", ["dir", root, "--config", join(root, ".gitleaks.toml"), "--no-banner", "--exit-code", "0", "--report-format", "json", "--report-path", out, "--max-target-megabytes", "5"]);
    const reported = (JSON.parse(await readFile(out, "utf8")) as { File: string; StartLine: number; RuleID: string }[])
      .map((f) => ({ file: relative(root, f.File), line: f.StartLine, rule: f.RuleID }))
      .filter((f) => !f.file.startsWith(".agents/skills/") && !f.file.includes("node_modules/"));
    // Build and test output (gitignored) is not written by this repository either.
    const ignored = new Set((await gitIgnored(root, reported.map((f) => f.file))));
    const findings = reported.filter((f) => !ignored.has(f.file)).map((f) => `${f.file}:${f.line} ${f.rule}`);

    expect(findings).toEqual([]);
  }, 120_000);

  it("scans the texts, naming them by the label they were given", async () => {
    const { repo, base } = await branchWith({});

    const findings = await scanner.scan({
      repo,
      base,
      head: null,
      texts: [
        { name: "result.pullRequestBody", text: "## Summary\n\nDone.\n" },
        { name: "result.review.summary", text: `Reviewed.\nThe webhook is ${STRIPE_WEBHOOK}.\n` },
      ],
    });

    expect(findings).toEqual([{ source: "result.review.summary", line: 2, rule: "stripe-webhook-secret" }]);
  });

  it("only scans the commits after the base", async () => {
    const { repo, head } = await branchWith({ "src/pay.ts": `export const key = "${STRIPE_KEY}";\n` });

    expect(await scanner.scan({ repo, base: head, head, texts: [] })).toEqual([]);
  });

  it("lets an exception of the config file through, and nothing else does", async () => {
    const { repo, base, head } = await branchWith({
      "docs/example.md": `key: ${STRIPE_KEY}\n`,
      // The branch cannot silence the scan itself: neither a comment nor an ignore file counts.
      "src/pay.ts": `export const key = "${STRIPE_KEY}"; // gitleaks:allow\n`,
      ".gitleaksignore": "docs/example.md:stripe-secret-key:1\nsrc/pay.ts:stripe-secret-key:1\n",
    });
    const dir = await tempDir("factory-gitleaks-config-");
    const config = join(dir, "gitleaks.toml");
    const exception = '\n[[allowlists]]\ndescription = "an example"\npaths = [\'\'\'docs/example\\.md\'\'\']\n';
    await writeFile(config, (await readFile(GITLEAKS_CONFIG, "utf8")) + exception);

    const findings = await new GitleaksScanner({ config }).scan({ repo, base, head, texts: [] });

    expect(findings.map((f) => f.source)).toEqual(["src/pay.ts"]);
  });

  it("fails, instead of finding nothing, when gitleaks cannot run", async () => {
    const { repo, base, head } = await branchWith({});

    await expect(new GitleaksScanner({ bin: "gitleaks-not-installed" }).scan({ repo, base, head, texts: [] })).rejects.toThrow(/gitleaks did not run: gitleaks-not-installed is not installed/);
    await expect(new GitleaksScanner({ config: "/nonexistent.toml" }).scan({ repo, base, head, texts: [] })).rejects.toThrow(/gitleaks did not run/);
  });
});
