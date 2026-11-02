/**
 * Makes the TLS mode of a database address explicit. `pg` 8 reads `sslmode=require` as `verify-full`, but `pg` 9 will read it
 * with libpq semantics (encrypt only, no certificate check), so an address is written with `verify-full` before it is stored.
 * An address without `sslmode` (the local Docker Postgres, no TLS) and every other parameter stay as they are. The text is edited
 * in place, not parsed and re-built, so the password keeps its exact escaping.
 */
export function withVerifyFull(uri: string): string {
  return uri.replace(/([?&])sslmode=[^&#]*/, "$1sslmode=verify-full");
}
