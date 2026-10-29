import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Git } from "./git.ts";
import { skeletonAllowed, SKELETON_PATH } from "./scope.ts";
import type { Verify } from "./seams/verify.ts";

const WORKSPACE = "pnpm-workspace.yaml";
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const COMMIT = ["-c", "user.name=Factory", "-c", "user.email=factory@localhost"];

/** The entries of the default `catalog:` block of a `pnpm-workspace.yaml`, as written (quotes dropped from the key). */
export function catalogEntries(yaml: string): Map<string, string> {
  const entries = new Map<string, string>();
  let inCatalog = false;
  for (const line of yaml.split("\n")) {
    if (/^catalog:\s*$/.test(line)) inCatalog = true;
    else if (/^\S/.test(line)) inCatalog = false;
    else if (inCatalog) {
      const m = /^ {2}("[^"]+"|[^\s#:"][^\s:]*):\s*(.+?)\s*$/.exec(line);
      if (m) entries.set(m[1]!.replaceAll('"', ""), m[2]!);
    }
  }
  return entries;
}

/** `yaml` with the catalog entry `name` set to `value` (added at the end of the block), or removed when `value` is null. */
export function withCatalogEntry(yaml: string, name: string, value: string | null): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^catalog:\s*$/.test(l));
  if (start === -1) return yaml;
  let end = start + 1;
  let last = start;
  for (; end < lines.length && !/^\S/.test(lines[end]!); end++) if (/^ {2}\S/.test(lines[end]!) && !lines[end]!.trimStart().startsWith("#")) last = end;
  const key = (l: string) => /^ {2}("[^"]+"|[^\s#:"][^\s:]*):/.exec(l)?.[1]?.replaceAll('"', "");
  const at = lines.findIndex((l, i) => i > start && i < end && key(l) === name);
  const quoted = /^[@]/.test(name) ? `"${name}"` : name;
  if (at !== -1) {
    if (value === null) lines.splice(at, 1);
    else lines[at] = `  ${lines[at]!.trimStart().startsWith('"') ? `"${name}"` : name}: ${value}`;
  } else if (value !== null) lines.splice(last + 1, 0, `  ${quoted}: ${value}`);
  return lines.join("\n");
}

/** The names a `package.json` takes from the default catalog. */
export function catalogUsers(packageJson: string): string[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(packageJson) as Record<string, unknown>;
  } catch {
    return [];
  }
  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries((parsed[field] ?? {}) as Record<string, unknown>).flatMap(([name, spec]) => (spec === "catalog:" || spec === "catalog:default" ? [name] : [])),
  );
}

async function show(git: Git, ref: string, path: string): Promise<string | null> {
  return git.run("show", `${ref}:${path}`).catch(() => null);
}

/**
 * The catalog entries the Skeleton change (`snapshots`: file → commit it was reverted from) uses and the base does not
 * have, or has with another version: name → version, as the commit that holds the change wrote them.
 */
export async function skeletonCatalog(git: Git, base: string, snapshots: Map<string, string>): Promise<Map<string, string>> {
  const baseCatalog = catalogEntries((await show(git, base, WORKSPACE)) ?? "");
  const carried = new Map<string, string>();
  for (const [path, sha] of snapshots) {
    if (!path.endsWith("package.json")) continue;
    const used = catalogUsers((await show(git, sha, path)) ?? "");
    if (used.length === 0) continue;
    const catalog = catalogEntries((await show(git, sha, WORKSPACE)) ?? "");
    for (const name of used) {
      const version = catalog.get(name);
      if (version !== undefined && version !== baseCatalog.get(name)) carried.set(name, version);
    }
  }
  return carried;
}

/**
 * Takes out of the branch's catalog the `carried` entries no package outside the Skeleton uses, back to the base's
 * version (or removed when the base has none), as a new commit; true when it committed.
 */
export async function dropSkeletonCatalog(git: Git, base: string, carried: Map<string, string>, message: string): Promise<boolean> {
  if (carried.size === 0) return false;
  const workspace = join(git.cwd, WORKSPACE);
  const original = await readFile(workspace, "utf8").catch(() => null);
  if (original === null) return false;
  const packages = (await git.run("ls-files", "-z", "--", "package.json", "*/package.json")).split("\0").filter((p) => p && !p.startsWith(SKELETON_PATH));
  const usedElsewhere = new Set<string>();
  for (const path of packages) for (const name of catalogUsers(await readFile(join(git.cwd, path), "utf8").catch(() => "{}"))) usedElsewhere.add(name);
  const baseCatalog = catalogEntries((await show(git, base, WORKSPACE)) ?? "");
  let text = original;
  for (const name of carried.keys()) if (!usedElsewhere.has(name)) text = withCatalogEntry(text, name, baseCatalog.get(name) ?? null);
  if (text === original) return false;
  await writeFile(workspace, text);
  await git.run("add", "--", WORKSPACE);
  await git.run(...COMMIT, "commit", "--quiet", "-m", message);
  return true;
}

export type AssembledSkeleton = { ok: true; patch: string } | { ok: false; output: string; failedCommand: string | null; timedOut: boolean };

/**
 * The Skeleton pull request as it will be: `patch` (the Skeleton files) and the `carried` catalog entries applied on
 * `base` in a throwaway worktree, where `verify.checkSkeleton` regenerates the lockfile and the generated files and
 * runs typecheck and lint. Returns the whole change as a patch against `base`, or the failed check's output.
 * This executes the branch's code, so it belongs to `work`, which has no token; `publish` only applies the result.
 */
export async function assembleSkeletonChange(
  git: Git,
  base: string,
  patch: string,
  carried: Map<string, string>,
  verify: Verify,
  timeoutMs: number,
): Promise<AssembledSkeleton> {
  const dir = await mkdtemp(join(tmpdir(), "factory-skeleton-check-"));
  const tree = new Git(dir);
  try {
    await git.run("worktree", "add", "--quiet", "--detach", dir, base);
    const file = join(dir, ".factory-skeleton.patch");
    await writeFile(file, patch);
    await tree.run("apply", "--index", "--whitespace=nowarn", file);
    await rm(file, { force: true });
    if (carried.size > 0) {
      let text = await readFile(join(dir, WORKSPACE), "utf8");
      for (const [name, version] of carried) text = withCatalogEntry(text, name, version);
      await writeFile(join(dir, WORKSPACE), text);
    }
    const check = await verify.checkSkeleton({ dir, timeoutMs });
    if (!check.ok) return { ok: false, output: check.output, failedCommand: check.failedCommand, timedOut: check.timedOut };
    await tree.run("add", "-A");
    const names = (await tree.run("-c", "core.quotePath=false", "diff", "--cached", "--name-only", "--no-renames", base)).split("\n").filter(Boolean);
    const kept = names.filter(skeletonAllowed);
    const full = kept.length > 0 ? await tree.run("diff", "--cached", "--binary", "--no-renames", "--full-index", base, "--", ...kept) : "";
    return { ok: true, patch: full };
  } finally {
    await git.run("worktree", "remove", "--force", dir).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}
