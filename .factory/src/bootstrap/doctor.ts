import { labelSpecs } from "./labels.ts";
import type { BootstrapDeps } from "./steps.ts";

export type CheckStatus = "ok" | "missing" | "warn" | "off" | "skip";

export interface Check {
  group: string;
  status: CheckStatus;
  name: string;
  detail?: string;
}

export interface DoctorReport {
  checks: Check[];
  /** False when something required is missing. `off`, `warn` and `skip` do not fail. */
  ok: boolean;
}

const MODULE_SWITCHES = [
  ["DEPLOY_ENABLED", "production deploy"],
  ["PREVIEWS_ENABLED", "PR previews"],
  ["FACTORY_ENABLED", "the Factory"],
] as const;

/** Read-only: lists and reads, never creates, sets or prompts. */
export async function doctor(deps: BootstrapDeps): Promise<DoctorReport> {
  const { github, config, env } = deps;
  const checks: Check[] = [];
  const add = (group: string, status: CheckStatus, name: string, detail?: string) => checks.push({ group, status, name, detail });

  const [repo, secrets, variables, labels] = await Promise.all([
    github.repo(),
    github.listSecrets(),
    github.listVariables(),
    github.listLabels(),
  ]);

  add("GitHub", "ok", "Repository", `${repo.fullName} (${repo.visibility})`);
  add(
    "GitHub",
    repo.viewerPermission === "ADMIN" ? "ok" : "missing",
    "Repo permission",
    repo.viewerPermission === "ADMIN" ? "admin" : `${repo.viewerPermission.toLowerCase()}: the wizard needs admin to set secrets and variables`,
  );

  for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    add("Secrets", secrets.includes(name) ? "ok" : "missing", name, secrets.includes(name) ? undefined : "run `pnpm bootstrap`");
  }
  const claude = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"].filter((n) => secrets.includes(n));
  if (claude.length === 2) add("Secrets", "warn", "Claude auth", "both exist: ANTHROPIC_API_KEY wins; delete one");
  else if (claude.length === 1) add("Secrets", "ok", "Claude auth", claude[0]);
  else add("Secrets", "off", "Claude auth", "the Factory cannot run without CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY");
  add("Secrets", secrets.includes("FACTORY_TOKEN") ? "ok" : "off", "FACTORY_TOKEN", secrets.includes("FACTORY_TOKEN") ? undefined : "machine user not configured");

  for (const [name, what] of MODULE_SWITCHES) {
    const on = variables[name] === "true";
    add("Variables", on ? "ok" : "off", name, on ? undefined : `${what} is switched off`);
  }
  if (variables.FACTORY_USE_ENVIRONMENTS === "false") {
    add("Variables", "off", "Environments", "secrets live at repo level: the plan or visibility refused environments or the ruleset; rerun the wizard after upgrading");
  }

  const have = new Map(labels.map((l) => [l.name, l]));
  for (const want of labelSpecs(config)) {
    const found = have.get(want.name);
    const same = found && found.color === want.color && found.description === want.description;
    add("Labels", same ? "ok" : "missing", want.name, same ? undefined : found ? "differs from config.ts" : "run `pnpm bootstrap`");
  }

  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    add("Resources", "skip", "workers.dev", "export CLOUDFLARE_API_TOKEN to check it (secrets cannot be read back)");
  } else {
    try {
      const client = deps.cloudflare(token);
      const accounts = await client.listAccounts();
      const subdomain = accounts[0] ? await client.getWorkersSubdomain(accounts[0].id) : null;
      add("Resources", subdomain ? "ok" : "missing", "workers.dev", subdomain ?? "no subdomain registered; run `pnpm bootstrap`");
    } catch (error) {
      add("Resources", "missing", "workers.dev", (error as Error).message);
    }
  }

  return { checks, ok: !checks.some((c) => c.status === "missing") };
}

export function formatReport(report: DoctorReport): string {
  const lines: string[] = [];
  let group = "";
  for (const check of report.checks) {
    if (check.group !== group) {
      group = check.group;
      lines.push("", `${group}`);
    }
    lines.push(`  ${check.status.padEnd(8)}${check.name}${check.detail ? `  ${check.detail}` : ""}`);
  }
  lines.push("", report.ok ? "doctor: everything required is in place." : "doctor: something required is missing.");
  return lines.join("\n").trimStart();
}
