/** The OpenAPI document config, shared by `/api/openapi.json` and `skeleton generate`. */
export function openApiConfig(title: string) {
  return { openapi: "3.1.0", info: { title, version: "1.0.0" } };
}
