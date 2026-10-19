/** How many `PasswordHasher` objects share the hashing work. */
export const PASSWORD_HASHER_POOL_SIZE = 16;

/** What the Worker calls on a `PasswordHasher` stub (its RPC methods). */
export type PasswordHasherStub = {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
};

/** The `PASSWORD_HASHER` Durable Object namespace, as the Worker uses it. */
export type PasswordHasherPool = { getByName(name: string): PasswordHasherStub };

/**
 * Better Auth's `emailAndPassword.password` over the `PasswordHasher` pool: each
 * call goes to one of 16 objects picked at random, so no single object queues
 * every login. An error the runtime marks `.retryable` (and not `.overloaded`)
 * is retried once on a fresh stub; hashing and verifying are idempotent.
 */
export function passwordHashing(pool: PasswordHasherPool) {
  async function call<T>(method: (stub: PasswordHasherStub) => Promise<T>): Promise<T> {
    try {
      return await method(pick(pool));
    } catch (error) {
      if (!isRetryable(error)) throw error;
      return method(pick(pool));
    }
  }
  return {
    hash: (password: string) => call((stub) => stub.hash(password)),
    verify: ({ hash, password }: { hash: string; password: string }) => call((stub) => stub.verify(hash, password)),
  };
}

function pick(pool: PasswordHasherPool) {
  const [random] = crypto.getRandomValues(new Uint32Array(1));
  return pool.getByName(`hasher-${random! % PASSWORD_HASHER_POOL_SIZE}`);
}

function isRetryable(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const flags = error as { retryable?: unknown; overloaded?: unknown };
  return flags.retryable === true && flags.overloaded !== true;
}
