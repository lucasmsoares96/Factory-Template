import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { expect, test } from "vitest";
import { mcpToolsFrom } from "../src/node/mcp-tools.ts";
import { openApiConfig } from "../src/platform/openapi.ts";

// Seam 6: the MCP tool list `pnpm generate` derives from a composed OpenAPI document.

const Note = z
  .object({ id: z.string().openapi({ description: "The note's id." }), text: z.string() })
  .openapi("Note");
const ok = (schema: z.ZodType) => ({ description: "Done.", content: { "application/json": { schema } } });
const described = { summary: "A summary", description: "A description." };

function documentOf(build: (api: OpenAPIHono) => void) {
  const api = new OpenAPIHono();
  build(api);
  return new OpenAPIHono().route("/api", api).getOpenAPI31Document(openApiConfig("test"));
}

test("turns each operation into a tool named by its operationId, with the route's inputs and output", () => {
  const document = documentOf((api) =>
    api.openapi(
      createRoute({
        method: "get",
        path: "/notes/{id}",
        operationId: "getNote",
        summary: "Get a note",
        description: "Answers one note of the signed-in user.",
        request: {
          params: z.object({ id: z.string().openapi({ description: "The note's id." }) }),
          query: z.object({ shout: z.enum(["yes", "no"]).optional() }),
        },
        responses: { 200: ok(Note) },
      }),
      (c) => c.json({ id: "1", text: "" }, 200),
    ),
  );

  expect(mcpToolsFrom(document)).toEqual([
    {
      name: "getNote",
      title: "Get a note",
      description: "Answers one note of the signed-in user.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The note's id." },
          shout: { type: "string", enum: ["yes", "no"] },
        },
        required: ["id"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "The note's id." }, text: { type: "string" } },
        required: ["id", "text"],
      },
      annotations: { title: "Get a note", readOnlyHint: true, openWorldHint: false },
      scope: "read",
      http: { method: "GET", path: "/api/notes/{id}", pathParams: ["id"], queryParams: ["shout"], body: false, output: "object" },
    },
  ]);
});

test("puts a JSON request body under `body`, and wraps an output that is not an object as `result`", () => {
  const document = documentOf((api) =>
    api.openapi(
      createRoute({
        method: "post",
        path: "/notes",
        operationId: "createNotes",
        ...described,
        request: {
          body: { required: true, content: { "application/json": { schema: z.object({ text: z.string().min(1) }) } } },
        },
        responses: { 201: ok(z.array(Note)) },
      }),
      (c) => c.json([], 201),
    ),
  );

  const [tool] = mcpToolsFrom(document);

  expect(tool?.inputSchema).toEqual({
    type: "object",
    properties: {
      body: { type: "object", properties: { text: { type: "string", minLength: 1 } }, required: ["text"] },
    },
    required: ["body"],
    additionalProperties: false,
  });
  expect(tool?.outputSchema).toEqual({
    type: "object",
    properties: {
      result: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string", description: "The note's id." }, text: { type: "string" } },
          required: ["id", "text"],
        },
      },
    },
    required: ["result"],
  });
  expect(tool?.http).toMatchObject({ method: "POST", body: true, output: "result" });
});

test("derives the scope and the annotations from the HTTP verb", () => {
  const route = (method: "get" | "post" | "put" | "patch" | "delete", operationId: string) =>
    createRoute({ method, path: `/${operationId}`, operationId, ...described, responses: { 204: { description: "Done." } } });
  const document = documentOf((api) => {
    for (const [method, id] of [
      ["get", "readIt"],
      ["post", "createIt"],
      ["put", "replaceIt"],
      ["patch", "updateIt"],
      ["delete", "deleteIt"],
    ] as const) {
      api.openapi(route(method, id), (c) => c.body(null, 204));
    }
  });

  const tools = Object.fromEntries(mcpToolsFrom(document).map((tool) => [tool.name, tool]));

  expect(Object.keys(tools)).toEqual(["createIt", "deleteIt", "readIt", "replaceIt", "updateIt"]);
  expect(tools.readIt).toMatchObject({ scope: "read", annotations: { readOnlyHint: true } });
  expect(tools.createIt).toMatchObject({
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  });
  expect(tools.replaceIt).toMatchObject({ scope: "write", annotations: { destructiveHint: false, idempotentHint: true } });
  expect(tools.updateIt).toMatchObject({ scope: "write", annotations: { destructiveHint: false, idempotentHint: false } });
  expect(tools.deleteIt).toMatchObject({ scope: "write", annotations: { destructiveHint: true, idempotentHint: false } });
  for (const tool of Object.values(tools)) {
    expect(tool.outputSchema).toBeUndefined();
    expect(tool.http.output).toBe("none");
    expect(tool.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
  }
});

test("leaves out operations marked `x-mcp: false` and Better Auth's routes", () => {
  const document = documentOf((api) => {
    api.openapi(
      createRoute({ method: "get", path: "/health", operationId: "getHealth", ...described, "x-mcp": false, responses: { 200: ok(Note) } }),
      (c) => c.json({ id: "", text: "" }, 200),
    );
    api.openapi(
      createRoute({ method: "get", path: "/auth/get-session", operationId: "getSession", ...described, responses: { 200: ok(Note) } }),
      (c) => c.json({ id: "", text: "" }, 200),
    );
  });

  expect(mcpToolsFrom(document)).toEqual([]);
});

test("refuses an exposed operation without an operationId, a summary or a description", () => {
  const document = documentOf((api) => {
    api.openapi(
      createRoute({ method: "get", path: "/a", summary: "A", description: "A.", responses: { 200: ok(Note) } }),
      (c) => c.json({ id: "", text: "" }, 200),
    );
    api.openapi(
      createRoute({ method: "post", path: "/b", operationId: "createB", description: "B.", responses: { 200: ok(Note) } }),
      (c) => c.json({ id: "", text: "" }, 200),
    );
    api.openapi(
      createRoute({ method: "delete", path: "/c", operationId: "deleteC", summary: "C", responses: { 200: ok(Note) } }),
      (c) => c.json({ id: "", text: "" }, 200),
    );
    // Opted out of the MCP: not checked.
    api.openapi(createRoute({ method: "get", path: "/d", "x-mcp": false, responses: { 200: ok(Note) } }), (c) =>
      c.json({ id: "", text: "" }, 200),
    );
  });

  expect(() => mcpToolsFrom(document)).toThrow(
    [
      "Every operation the MCP exposes needs an operationId, a summary and a description (or `x-mcp: false`):",
      "  GET /api/a: no operationId",
      "  POST /api/b: no summary",
      "  DELETE /api/c: no description",
    ].join("\n"),
  );
});
