import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The parent of the first migration in a Drizzle chain. */
const ROOT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Drizzle chains migrations through `snapshot.json`: each one has an `id` and names its parent in `prevIds`. Two
 * branches that each generate a migration on top of the same one add two folders, which git merges without a
 * conflict and `drizzle-kit check` accepts, yet the chain has forked. Lists every fork and every missing parent
 * under `dir`, each naming the folder to delete and generate again (the newer one of a fork). Empty when the chain
 * is linear or there are no migrations.
 */
export function findBrokenMigrationChain({ dir, cwd = process.cwd() }: { dir: string; cwd?: string }): string[] {
  const root = join(cwd, dir);
  if (!existsSync(root)) return [];
  const snapshots = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "snapshot.json")))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const snapshot = JSON.parse(readFileSync(join(root, name, "snapshot.json"), "utf8")) as { id?: string; prevIds?: string[] };
      return { folder: `${dir}/${name}`, id: snapshot.id ?? "", parents: snapshot.prevIds ?? [] };
    });

  const ids = new Set(snapshots.map((s) => s.id));
  const firstChild = new Map<string, string>();
  const problems: string[] = [];
  for (const snapshot of snapshots) {
    for (const parent of snapshot.parents) {
      if (parent !== ROOT_ID && !ids.has(parent)) {
        problems.push(`${snapshot.folder}: its parent ${parent} is missing. Delete ${snapshot.folder} and generate it again on top of the newest migration.`);
        continue;
      }
      const sibling = firstChild.get(parent);
      if (sibling === undefined) firstChild.set(parent, snapshot.folder);
      else problems.push(`${snapshot.folder} and ${sibling} both follow ${parent}: the chain forked. Delete ${snapshot.folder} and generate it again on top of the newest migration.`);
    }
  }
  return problems;
}
