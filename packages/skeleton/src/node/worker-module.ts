import { runnerImport } from "vite";

// Dependencies that import `cloudflare:*` themselves: Vite transforms them (instead
// of handing them to Node), so the stub below reaches their imports too.
const RUNTIME_DEPENDENCIES = ["@cloudflare/workers-oauth-provider"];

// What a Worker's entry may import from the runtime, stubbed for Node: enough to
// evaluate the module (Durable Object classes extend `DurableObject`), never to run it.
const RUNTIME_STUB = "\0skeleton:cloudflare-runtime-stub";
const runtimeStub = `
export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
export const env = {};
// The flags the Workers this module stands for run with (the OAuth provider checks one on load).
globalThis.Cloudflare ??= { compatibilityFlags: { nodejs_compat: true, global_fetch_strictly_public: true } };
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
    // `inline` is the environment `runnerImport` runs in.
    environments: { inline: { resolve: { noExternal: RUNTIME_DEPENDENCIES } } },
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
