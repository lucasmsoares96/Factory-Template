import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { Generator, getConfig } from "@tanstack/router-generator";
import { pluginFaker } from "@kubb/plugin-faker";
import { pluginFetch } from "@kubb/plugin-fetch";
import { pluginMsw } from "@kubb/plugin-msw";
import { pluginReactQuery } from "@kubb/plugin-react-query";
import { pluginTs } from "@kubb/plugin-ts";
import { createKubb } from "kubb";
import { openApiConfig } from "../platform/openapi.ts";
import { mcpToolsFrom } from "./mcp-tools.ts";
import { routerConfig, type SpaLayout } from "../vite/router.ts";

/** Faker's seed for the generated MSW handlers: tests see the same data on every run. */
export const FAKER_SEED = 42;

export type GenerateOptions = SpaLayout & {
  /** The composed Hono app (a Product Worker's default export). */
  app: OpenAPIHono<any>;
  /** Titles the OpenAPI document. */
  title: string;
  /** Where the MCP tool list goes, relative to `dir` (committed: the `tools/list` snapshot). */
  mcpTools: string;
};

/** A Product's MCP tool list, next to its Worker entry. */
export const PRODUCT_MCP_TOOLS = "src/mcp-tools.gen.json";

/**
 * `pnpm generate` for one composition (a Product, or the Skeleton's test SPA):
 * 1. the OpenAPI 3.1 document of the composed app → `openapi.json` (not committed);
 * 2. Kubb over it → `src/gen/` (types, fetch client, TanStack Query hooks, Faker data
 *    and MSW handlers; not committed);
 * 3. TanStack Router's route tree → `routeTree.gen.ts` (committed);
 * 4. the MCP tools, one per exposed operation → `mcp-tools.gen.json` (committed:
 *    the Worker serves `tools/list` from it, so a change to it shows in the diff).
 *    Fails when an exposed operation has no operationId, summary or description.
 */
export async function generate(options: GenerateOptions) {
  const { dir, app, title } = options;
  const document = app.getOpenAPI31Document(openApiConfig(title));
  await writeFile(join(dir, "openapi.json"), `${JSON.stringify(document, null, 2)}\n`);
  const tools = mcpToolsFrom(document);
  await writeFile(join(dir, options.mcpTools), `${JSON.stringify(tools, null, 2)}\n`);

  await generateClient(dir);
  await generateRouteTree(options);
}

async function generateClient(dir: string) {
  const kubb = createKubb({
    root: dir,
    input: "./openapi.json",
    output: { path: "./src/gen", clean: true },
    plugins: [
      pluginTs({ output: { path: "types" } }),
      pluginFetch({ output: { path: "clients" }, returnType: "data" }),
      pluginReactQuery({ output: { path: "hooks" }, hooks: true }),
      pluginFaker({ output: { path: "mocks" }, seed: [FAKER_SEED] }),
      pluginMsw({ output: { path: "msw" }, parser: "faker", handlers: true }),
    ],
  });
  const { success, diagnostics } = await kubb.generate();
  if (!success) {
    throw new Error(`Kubb failed:\n${diagnostics.map((d) => JSON.stringify(d)).join("\n")}`);
  }
}

async function generateRouteTree(layout: SpaLayout) {
  const config = getConfig(routerConfig(layout), layout.dir);
  await mkdir(dirname(config.generatedRouteTree), { recursive: true });
  await new Generator({ config, root: layout.dir }).run();
}
