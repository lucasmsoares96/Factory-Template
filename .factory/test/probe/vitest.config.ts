import { defineConfig } from "vitest/config";

/** Runs only the probe of `temp-hygiene.test.ts`; git settings come from the parent's environment. */
export default defineConfig({ test: { include: ["probe.fixture.ts"], root: import.meta.dirname } });
