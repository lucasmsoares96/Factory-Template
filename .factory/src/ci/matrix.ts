// The `plan` job of the PR workflow: which packages get a `build` job.
// `node .factory/src/ci/matrix.ts --base <sha> --head <sha>` asks turbo for the
// affected packages (a root file in `globalDependencies`, the lockfile or a
// package's own files changed) and prints the matrix; with GITHUB_OUTPUT set it
// also writes `matrix` and `empty` for the jobs that follow.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";

/** The package of `.factory/`; `.github/` belongs to no package, so a change there selects it too. */
export const HARNESS_PACKAGE = "@factory/harness";
const ROOT_PACKAGE = "//";

export interface AffectedPackage {
  name: string;
  path: string;
}
export interface MatrixEntry {
  /** The package name, also the `--filter` for `factory:verify`. */
  name: string;
  /** `product` for `apps/*`, `package` for the rest (the Skeleton, the harness). */
  kind: "product" | "package";
}
export interface Matrix {
  include: MatrixEntry[];
}

/** One entry per affected package, plus the harness when only `.github/` or `.factory/` changed. */
export function buildMatrix(input: { affected: AffectedPackage[]; changedFiles: string[]; packages: AffectedPackage[] }): Matrix {
  const byName = new Map<string, AffectedPackage>();
  for (const pkg of input.affected) if (pkg.name !== ROOT_PACKAGE) byName.set(pkg.name, pkg);
  if (input.changedFiles.some((file) => file.startsWith(".github/") || file.startsWith(".factory/"))) {
    const harness = input.packages.find((pkg) => pkg.name === HARNESS_PACKAGE);
    if (harness) byName.set(harness.name, harness);
  }
  const include = [...byName.values()]
    .map((pkg): MatrixEntry => ({ name: pkg.name, kind: pkg.path.startsWith("apps/") ? "product" : "package" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { include };
}

function turbo<T>(args: string[]): T {
  const out = execFileSync("pnpm", ["exec", "turbo", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(out.slice(out.indexOf("{"))) as T;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { base: { type: "string" }, head: { type: "string", default: "HEAD" } } });
  if (!values.base) throw new Error("Missing --base");
  const affected = turbo<{ data: { affectedPackages: { items: AffectedPackage[] } } }>([
    "query", "affected", "--packages", "--base", values.base, "--head", values.head!,
  ]).data.affectedPackages.items;
  const packages = turbo<{ data: { packages: { items: AffectedPackage[] } } }>(["query", "{ packages { items { name path } } }"]).data.packages.items;
  const changedFiles = execFileSync("git", ["diff", "--name-only", `${values.base}...${values.head}`], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const matrix = buildMatrix({ affected, changedFiles, packages });
  console.log(JSON.stringify(matrix));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nempty=${matrix.include.length === 0}\n`);
  }
}
