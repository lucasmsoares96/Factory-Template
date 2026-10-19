import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hasMigrations, migrateDatabase } from "./migrate.ts";

const skeletonDir = fileURLToPath(new URL("../..", import.meta.url));
const drizzleKit = join(dirname(createRequire(import.meta.url).resolve("drizzle-kit")), "bin.cjs");

type Problem = { project: string; message: string };

/**
 * Proves the committed migrations and the TypeScript schema agree: runs
 * `drizzle-kit check`, migrates a brand-new database (Skeleton first, then the
 * Product), and expects `drizzle-kit push --explain` to find `no_changes`.
 * The database is created on the server at `serverUrl` and dropped afterwards.
 */
export async function checkMigrations({
  serverUrl,
  productDir,
}: {
  serverUrl: string;
  productDir?: string;
}): Promise<{ ok: boolean; report: string }> {
  const projects = [{ project: "skeleton", dir: skeletonDir }];
  if (productDir) projects.push({ project: "product", dir: resolve(productDir) });

  const checks = await Promise.all(
    projects.map(async ({ project, dir }) => {
      const run = await kit(dir, ["check"], process.env);
      return run.status === 0 ? [] : [{ project, message: `drizzle-kit check failed:\n${run.output}` }];
    }),
  );
  const problems: Problem[] = checks.flat();
  if (problems.length) return result(problems);

  const database = `check_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  await admin(serverUrl, `CREATE DATABASE "${database}"`);
  try {
    await migrateDatabase({
      databaseUrl: url.toString(),
      productMigrationsFolder: productDir && join(resolve(productDir), "drizzle"),
    });
    const drifts = await Promise.all(
      projects.map(async ({ project, dir }) => {
        const problem = await drift(dir, url.toString());
        return problem ? [{ project, message: problem }] : [];
      }),
    );
    problems.push(...drifts.flat());
  } finally {
    await admin(serverUrl, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  }
  return result(problems);
}

/** Compares a freshly migrated database with the schema; returns a problem or nothing. */
async function drift(dir: string, databaseUrl: string): Promise<string | undefined> {
  const run = await kit(dir, ["push", "--explain", "--output", "json"], {
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
  const json = run.stdout.trim().split("\n").findLast((line) => line.startsWith("{"));
  const explain = json ? (JSON.parse(json) as Explain) : undefined;
  if (explain?.status === "no_changes") return undefined;
  // A Product with no tables of its own yet has neither schema files nor migrations.
  if (
    explain?.status === "error" &&
    explain.error?.code === "schema_files_not_found_error" &&
    !hasMigrations(join(dir, "drizzle"))
  ) {
    return undefined;
  }
  if (explain?.status === "ok") {
    return `schema differs from its migrations; generate a migration. Pending changes:\n${explain.statements
      ?.map((statement) => `  ${JSON.stringify(statement)}`)
      .join("\n")}`;
  }
  return `drizzle-kit push --explain failed:\n${run.output}`;
}

type Explain = {
  status: "no_changes" | "ok" | "error";
  statements?: unknown[];
  error?: { code?: string };
};

function kit(cwd: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null; stdout: string; output: string }>((done, fail) => {
    const child = spawn(process.execPath, [drizzleKit, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", fail);
    child.on("close", (status) => done({ status, stdout, output: `${stdout}${stderr}` }));
  });
}

function result(problems: Problem[]) {
  return {
    ok: problems.length === 0,
    report: problems.length
      ? problems.map((p) => `[${p.project}] ${p.message}`).join("\n\n")
      : "Migrations match the schema.",
  };
}

async function admin(serverUrl: string, sql: string) {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
