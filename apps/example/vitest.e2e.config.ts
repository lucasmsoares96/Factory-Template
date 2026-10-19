import { defineConfig } from "vitest/config";

// Runs against the production build (`vite build` output); turbo builds first.
export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    include: ["test/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
