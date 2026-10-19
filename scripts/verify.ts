// `pnpm factory:verify`: generate (which must leave the tree unchanged), then
// typecheck, lint, test and e2e for every package (only the affected ones with
// --affected, or on CI). Uses DATABASE_URL when set; otherwise starts a
// throwaway docker compose Postgres and removes it after.
import { spawnSync } from "node:child_process";
import { ensurePostgres, filesChangedBy } from "@workspace/skeleton/node";

const affected = process.argv.includes("--affected") || Boolean(process.env.CI);
const turbo = (...tasks: string[]) =>
  spawnSync("turbo", ["run", ...tasks, ...(affected ? ["--affected"] : [])], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: postgres.url },
  }).status ?? 1;

const postgres = ensurePostgres({ purpose: "verify" });
let status = 1;
try {
  // Seam 6: generated artifacts are committed up to date.
  let generated = 1;
  const changed = filesChangedBy(() => (generated = turbo("generate")), process.cwd());
  if (generated !== 0) {
    status = generated;
  } else if (changed.length) {
    console.error(
      `\`pnpm generate\` changed files that must be committed as generated:\n` +
        `${changed.map((path) => `  ${path}`).join("\n")}\nRun \`pnpm generate\` and commit the result.`,
    );
  } else {
    status = turbo("typecheck", "lint", "test", "e2e");
  }
} finally {
  postgres.stop();
}
process.exit(status);
