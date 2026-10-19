import { expect, test } from "vitest";
import { passwordHashing, type PasswordHasherStub } from "../src/platform/password.ts";

// The Worker's side of the `PasswordHasher` Durable Object, over a fake namespace.
// The Durable Object itself runs in the HTTP tests (sign-up.test.ts).

function runtimeError(flags: { retryable?: boolean; overloaded?: boolean }) {
  return Object.assign(new Error("Durable Object reset because its code was updated."), flags);
}

/** A namespace whose stubs answer from `script`, one entry per call, recording the names used. */
function fakePool(script: Array<Error | string>) {
  const names: string[] = [];
  const stub: PasswordHasherStub = {
    async hash() {
      const next = script.shift();
      if (next instanceof Error) throw next;
      return next ?? "salt:key";
    },
    async verify() {
      return true;
    },
  };
  return {
    names,
    pool: {
      getByName(name: string) {
        names.push(name);
        return stub;
      },
    },
  };
}

test("spreads calls over a pool of 16 named objects", async () => {
  const { names, pool } = fakePool([]);
  const hashing = passwordHashing(pool);

  for (let i = 0; i < 200; i++) await hashing.hash("secret");

  expect(new Set(names).size).toBeGreaterThan(8);
  for (const name of names) expect(name).toMatch(/^hasher-(\d|1[0-5])$/);
});

test("retries once, on a fresh stub, when the runtime marks the error retryable", async () => {
  const { names, pool } = fakePool([runtimeError({ retryable: true }), "salt:key"]);

  expect(await passwordHashing(pool).hash("secret")).toBe("salt:key");
  expect(names).toHaveLength(2);
});

test("gives up after one retry", async () => {
  const { pool } = fakePool([runtimeError({ retryable: true }), runtimeError({ retryable: true })]);

  await expect(passwordHashing(pool).hash("secret")).rejects.toThrow("Durable Object reset");
});

test("never retries an overloaded object or an error that is not retryable", async () => {
  for (const error of [runtimeError({ retryable: true, overloaded: true }), runtimeError({})]) {
    const { names, pool } = fakePool([error, "salt:key"]);

    await expect(passwordHashing(pool).hash("secret")).rejects.toThrow();
    expect(names).toHaveLength(1);
  }
});
