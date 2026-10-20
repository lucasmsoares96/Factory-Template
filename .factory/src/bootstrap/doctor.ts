import { labelSpecs } from "./labels.ts";
import { deployFirstMessage, productSecretName, readDnsState, readWorkerDomainState } from "./domain.ts";
import type { BootstrapDeps, StepContext } from "./steps.ts";

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
export async function doctor(deps: BootstrapDeps, productId?: string): Promise<DoctorReport> {
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

  if (productId) {
    const group = `Domain (${productId})`;
    try {
      const product = await deps.product(productId);
      const ctx: StepContext = { ...deps, memory: {} };
      const domainAdd = (status: CheckStatus, name: string, detail?: string) => add(group, status, name, detail);
      if (!product.domain) {
        domainAdd("off", "Domain", `empty: set \`domain\` in apps/${productId}/product.config.ts`);
      } else {
        domainAdd("ok", "Domain", product.domain);
        const key = productSecretName(product.id, "RESEND_API_KEY");
        domainAdd(secrets.includes(key) ? "ok" : "off", key, secrets.includes(key) ? undefined : `run \`pnpm bootstrap domain ${product.id}\``);
        try {
          const dns = await readDnsState(ctx, product, false);
          if (dns.kind === "no-resend-key") {
            domainAdd("skip", "Resend domain", "export RESEND_API_KEY to check it");
            domainAdd("skip", "DNS records", "needs the Resend domain");
          } else if (dns.kind === "no-domain") {
            domainAdd("off", "Resend domain", `not created (deferred?): the Product keeps the outbox; run \`pnpm bootstrap domain ${product.id}\``);
            domainAdd("skip", "DNS records", "needs the Resend domain");
          } else {
            domainAdd(dns.domain.status === "verified" ? "ok" : "warn", "Resend domain", `${dns.domain.name}: ${dns.domain.status}`);
            if (dns.kind === "no-cloudflare") domainAdd("skip", "DNS records", "export CLOUDFLARE_API_TOKEN to check them");
            else if (dns.kind === "no-zone") domainAdd("warn", "DNS records", "zone not in this Cloudflare account: create the records by hand");
            else if (dns.missing.length > 0) domainAdd("warn", "DNS records", `${dns.missing.length} missing in ${dns.zone.name}; run \`pnpm bootstrap domain ${product.id} --redo dns-records\``);
            else domainAdd("ok", "DNS records", dns.different.length > 0 ? `all present (${dns.different.length} with another value, left alone)` : "all present");
          }
          const worker = await readWorkerDomainState(ctx, product, false);
          if (worker.kind === "no-cloudflare") domainAdd("skip", "Worker Custom Domain", "export CLOUDFLARE_API_TOKEN to check it");
          else if (worker.kind === "no-worker") domainAdd("off", "Worker Custom Domain", deployFirstMessage(product.id));
          else if (worker.kind === "no-zone") domainAdd("warn", "Worker Custom Domain", "zone not in this Cloudflare account");
          else if (worker.kind === "attached") domainAdd("ok", "Worker Custom Domain", product.domain);
          else domainAdd("warn", "Worker Custom Domain", `not attached; run \`pnpm bootstrap domain ${product.id} --redo worker-domain\``);
        } catch (error) {
          domainAdd("warn", "Domain checks", (error as Error).message);
        }
      }
    } catch (error) {
      add(group, "missing", "Product", (error as Error).message);
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
