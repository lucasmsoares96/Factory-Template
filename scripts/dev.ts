// `pnpm dev [id]`: runs one Product's dev server. With a single Product in apps/
// the id is optional; with several, `pnpm dev <id>` picks one.
import { spawn } from "node:child_process";
import { findWorkspaceRoot, listProducts, resolveDevProduct } from "@workspace/skeleton/node";

const root = findWorkspaceRoot(process.cwd());
let id: string;
try {
  id = resolveDevProduct(listProducts(root), process.argv[2]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const child = spawn("pnpm", ["--filter", `./apps/${id}`, "run", "dev"], { cwd: root, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
