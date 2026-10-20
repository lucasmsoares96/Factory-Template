import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { msw } from "msw/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Seam 3: the Worker over HTTP (createTestHarness) against a real Postgres.
        test: {
          name: "node",
          globalSetup: ["./test/support/global-setup.ts"],
          include: ["test/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        // Seam 4: screens in a real browser, the API mocked by Kubb's MSW handlers.
        // msw/vite serves the worker script; nothing is copied into public/.
        plugins: [react(), msw({ mode: "worker-only" })],
        // Pre-bundled up front: a late discovery reloads the page mid-test.
        optimizeDeps: {
          include: [
            "class-variance-authority",
            "cn",
            "@faker-js/faker",
            "@base-ui/react/input",
            "@tanstack/react-form",
            "better-auth/react",
          ],
        },
        test: {
          name: "browser",
          include: ["test/**/*.browser.test.tsx"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
