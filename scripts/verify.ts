// `pnpm factory:verify`: typecheck, lint, test and e2e for every package
// (only the affected ones with --affected, or on CI). Uses DATABASE_URL when
// set; otherwise starts a throwaway docker compose Postgres and removes it after.
import { spawnSync } from "node:child_process";
import { ensurePostgres } from "@workspace/skeleton/node";

const affected = process.argv.includes("--affected") || Boolean(process.env.CI);
const postgres = ensurePostgres({ purpose: "verify" });
let status = 1;
try {
  const run = spawnSync(
    "turbo",
    ["run", "typecheck", "lint", "test", "e2e", ...(affected ? ["--affected"] : [])],
    { stdio: "inherit", env: { ...process.env, DATABASE_URL: postgres.url } },
  );
  status = run.status ?? 1;
} finally {
  postgres.stop();
}
process.exit(status);
