import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // A private TMPDIR for the run; it fails the run when tests leave temp dirs behind.
    globalSetup: ["./test/global-setup.ts"],
    // Each test spawns dozens of git processes in temporary repos; generous for loaded CI machines.
    testTimeout: 120_000,
    // Git in temporary repos: no user or system config, no hooks, no signing.
    env: {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: "commit.gpgsign",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_VALUE_1: "/dev/null",
      // No background `git maintenance` after each commit: it is one more process per git call.
      GIT_CONFIG_KEY_2: "maintenance.auto",
      GIT_CONFIG_VALUE_2: "false",
    },
  },
});
