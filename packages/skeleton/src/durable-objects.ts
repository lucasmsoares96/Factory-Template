// The Durable Object classes every Product Worker re-exports from its entry
// (`export { PasswordHasher } from "@workspace/skeleton/durable-objects"`) and
// binds in its wrangler.jsonc. Kept apart from the main entry: `cloudflare:workers`
// only exists inside the Workers runtime.
export { PasswordHasher } from "./platform/password-hasher.ts";
