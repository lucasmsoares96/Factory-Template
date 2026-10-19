import { setupWorker } from "msw/browser";
import { test as base } from "vitest";
import { handlers } from "../../src/gen/msw/handlers.ts";

/**
 * Browser Mode test with the API mocked by the MSW handlers Kubb generates from
 * the contract (Faker data, fixed seed). MSW 3 throws on a second `worker.start()`,
 * so the worker lives for the whole file (`scope: 'file'`, not the per-test recipe
 * in MSW's docs); each test's `worker.use(...)` overrides are reset after it.
 * A request no handler matches fails the test (`onUnhandledFrame: 'error'`).
 */
export const test = base
  // Vitest reads a fixture's dependencies from this (empty) pattern.
  // oxlint-disable-next-line no-empty-pattern
  .extend("worker", { scope: "file", auto: true }, async ({}, { onCleanup }) => {
    const worker = setupWorker(...handlers);
    await worker.start({ onUnhandledFrame: "error", quiet: true });
    onCleanup(() => worker.stop());
    return worker;
  })
  .extend("resetHandlers", { auto: true }, async ({ worker }, { onCleanup }) => {
    onCleanup(() => worker.resetHandlers());
  });

export { expect } from "vitest";
