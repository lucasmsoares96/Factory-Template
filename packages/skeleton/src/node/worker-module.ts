import { runnerImport } from "vite";

// What a Worker's entry may import from the runtime, stubbed for Node: enough to
// evaluate the module (Durable Object classes extend `DurableObject`), never to run it.
const RUNTIME_STUB = "\0skeleton:cloudflare-runtime-stub";
const runtimeStub = `
export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
export const env = {};
`;

/**
 * Imports a Worker's entry module in Node, e.g. to read its OpenAPI document.
 * Vite's module runner transforms it as the Worker build does (TypeScript, JSX),
 * and `cloudflare:*` modules, which only exist in the Workers runtime, resolve to a stub.
 */
export async function importWorkerModule(path: string): Promise<Record<string, unknown>> {
  const { module } = await runnerImport<Record<string, unknown>>(path, {
    configFile: false,
    logLevel: "error",
    plugins: [
      {
        name: "skeleton:cloudflare-runtime-stub",
        enforce: "pre",
        resolveId: (id) => (id.startsWith("cloudflare:") ? RUNTIME_STUB : undefined),
        load: (id) => (id === RUNTIME_STUB ? runtimeStub : undefined),
      },
    ],
  });
  return module;
}
