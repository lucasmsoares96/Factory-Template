import { defineConfig } from "vitest/config";

/**
 * Runs only the probe of `temp-hygiene.test.ts`; git settings come from the parent's environment.
 * Same test timeout as the harness (`../../vitest.config.ts`): the probe builds git fixtures, which under a loaded
 * machine take longer than vitest's 5 s default, and a timeout here would fail the hygiene test for the wrong reason.
 */
export default defineConfig({ test: { include: ["probe.fixture.ts"], root: import.meta.dirname, testTimeout: 120_000 } });
