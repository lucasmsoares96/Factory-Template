import type { JsonSchema, McpScope, McpTool } from "../platform/mcp/tool.ts";

type Parameter = { name: string; in: string; required?: boolean; description?: string; schema?: JsonSchema };
type MediaTypes = { [type: string]: { schema?: JsonSchema } };
type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: MediaTypes };
  responses?: { [status: string]: { content?: MediaTypes } };
  "x-mcp"?: boolean;
};
/** The part of an OpenAPI 3.1 document the generator reads. */
type OpenApiDocument = {
  paths?: { [path: string]: { [method: string]: unknown } };
  components?: { schemas?: { [name: string]: JsonSchema } };
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
/** What MCP clients accept as a tool name; the Anthropic directory caps it at 64 characters. */
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * The MCP tools of a composed OpenAPI document: one per `/api` operation, named
 * by its `operationId`, described by its `summary` and `description`, with its
 * parameters and JSON body as input and its 2xx JSON response as output. The
 * verb gives the scope (`GET` = `read`, the rest = `write`) and the annotations.
 * Better Auth's routes and operations marked `x-mcp: false` stay out. Throws
 * when an exposed operation lacks a name or a description, listing every one.
 */
export function mcpToolsFrom(openApiDocument: object): McpTool[] {
  const document = openApiDocument as OpenApiDocument;
  const schemas = document.components?.schemas ?? {};
  const problems: string[] = [];
  const tools: McpTool[] = [];

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (!path.startsWith("/api/") || path === "/api/auth" || path.startsWith("/api/auth/")) continue;
    for (const method of METHODS) {
      const operation = item[method] as Operation | undefined;
      if (!operation || operation["x-mcp"] === false) continue;
      const where = `${method.toUpperCase()} ${path}`;
      const missing = (["operationId", "summary", "description"] as const).filter((field) => !operation[field]?.trim());
      if (missing.length) {
        problems.push(...missing.map((field) => `${where}: no ${field}`));
        continue;
      }
      try {
        tools.push(toolOf(method, path, operation, (schema) => inline(schema, schemas)));
      } catch (error) {
        problems.push(`${where}: ${(error as Error).message}`);
      }
    }
  }

  const names = new Set<string>();
  for (const { name } of tools) {
    if (names.has(name)) problems.push(`operationId ${name} is used twice`);
    names.add(name);
  }
  if (problems.length) {
    throw new Error(
      "Every operation the MCP exposes needs an operationId, a summary and a description (or `x-mcp: false`):\n" +
        problems.map((problem) => `  ${problem}`).join("\n"),
    );
  }
  return tools.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function toolOf(
  method: (typeof METHODS)[number],
  path: string,
  operation: Operation,
  resolve: (schema: JsonSchema) => JsonSchema,
): McpTool {
  const name = operation.operationId!;
  if (!TOOL_NAME.test(name)) throw new Error(`operationId ${name} must be 1 to 64 of A-Z a-z 0-9 _ . -`);

  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const pathParams: string[] = [];
  const queryParams: string[] = [];
  for (const parameter of operation.parameters ?? []) {
    if (parameter.in !== "path" && parameter.in !== "query") {
      throw new Error(`the ${parameter.in} parameter ${parameter.name} cannot be a tool argument`);
    }
    const schema = resolve(parameter.schema ?? {});
    properties[parameter.name] =
      parameter.description && !schema.description ? { ...schema, description: parameter.description } : schema;
    if (parameter.in === "path" || parameter.required) required.push(parameter.name);
    (parameter.in === "path" ? pathParams : queryParams).push(parameter.name);
  }

  const bodySchema = operation.requestBody?.content?.["application/json"]?.schema;
  if (bodySchema) {
    if (properties.body) throw new Error("a parameter named `body` collides with the request body");
    properties.body = resolve(bodySchema);
    if (operation.requestBody?.required) required.push("body");
  }

  const inputSchema: JsonSchema = { type: "object", properties, ...(required.length && { required }), additionalProperties: false };
  const { outputSchema, output } = outputOf(operation, resolve);
  const verb = method.toUpperCase();
  const title = operation.summary!;
  return {
    name,
    title,
    description: operation.description!,
    inputSchema,
    ...(outputSchema && { outputSchema }),
    annotations:
      verb === "GET"
        ? { title, readOnlyHint: true, openWorldHint: false }
        : { title, readOnlyHint: false, destructiveHint: verb === "DELETE", idempotentHint: verb === "PUT", openWorldHint: false },
    scope: (verb === "GET" ? "read" : "write") satisfies McpScope,
    http: { method: verb, path, pathParams, queryParams, body: Boolean(bodySchema), output },
  };
}

function outputOf(operation: Operation, resolve: (schema: JsonSchema) => JsonSchema) {
  const success = Object.keys(operation.responses ?? {})
    .filter((status) => /^2\d\d$/.test(status))
    .sort()
    .map((status) => operation.responses![status]!.content?.["application/json"]?.schema)
    .find(Boolean);
  if (!success) return { output: "none" };
  const schema = resolve(success);
  if (schema.type === "object") return { outputSchema: schema, output: "object" };
  return { outputSchema: { type: "object", properties: { result: schema }, required: ["result"] }, output: "result" };
}

/**
 * `schema` with every `#/components/schemas/<name>` reference replaced by its
 * target, so a tool's schemas stand alone (2025 MCP clients do not follow `$ref`).
 */
function inline(schema: unknown, components: Record<string, JsonSchema>, seen: string[] = []): JsonSchema {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value !== "object" || value === null) return value;
    const { $ref, ...rest } = value as JsonSchema;
    if (typeof $ref === "string") {
      const name = $ref.replace(/^#\/components\/schemas\//, "");
      const target = components[name];
      if (name === $ref || !target) throw new Error(`cannot resolve ${$ref}`);
      if (seen.includes(name)) throw new Error(`schema ${name} refers to itself, which a tool schema cannot`);
      return { ...inline(target, components, [...seen, name]), ...(walk(rest) as JsonSchema) };
    }
    return Object.fromEntries(Object.entries(rest).map(([key, child]) => [key, walk(child)]));
  };
  return walk(schema) as JsonSchema;
}
