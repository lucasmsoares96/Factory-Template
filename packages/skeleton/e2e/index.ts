import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices, test as base } from "@playwright/test";
import { messagesFor, resolveLocale, type MessageOverrides, type Messages } from "../src/i18n/index.ts";

export { expect } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * Where `@evidence` prints go: `<repo>/test-results/evidence/<product>/<name>.png`.
 * The Factory collects them from here (`evidenceDir` in `.factory/src/config.ts`).
 */
export const EVIDENCE_DIR = join(repoRoot, "test-results/evidence");

/** Set by `defineE2EConfig` for the global setup, which starts the Product's Worker. */
export const PRODUCT_DIR_ENV = "SKELETON_E2E_PRODUCT_DIR";
/** Set by the global setup: the URL of the Worker under test. */
export const BASE_URL_ENV = "SKELETON_E2E_BASE_URL";

type E2EOptions = {
  /** The Product's id: names its evidence folder. */
  product: string;
  /** The build locale's texts with the Product's overrides: what the screens show. */
  t: Messages;
};

/**
 * The Skeleton's E2E test. Locate elements by role + i18n text (`t`) or
 * `data-testid`. Tag a test `@evidence` and call `evidence(name)` to save the
 * print the Factory posts on the PR.
 */
export const test = base.extend<{ evidence: (name: string) => Promise<void> }, E2EOptions>({
  product: ["", { option: true, scope: "worker" }],
  t: [messagesFor("en"), { option: true, scope: "worker" }],
  // Playwright reads a fixture's dependencies from this (empty) pattern.
  // oxlint-disable-next-line no-empty-pattern
  baseURL: async ({}, use) => {
    const url = process.env[BASE_URL_ENV];
    if (!url) throw new Error(`${BASE_URL_ENV} is not set: run the E2E through defineE2EConfig.`);
    await use(url);
  },
  evidence: async ({ page, product }, use, testInfo) => {
    await use(async (name) => {
      if (!testInfo.tags.includes("@evidence")) {
        throw new Error(`evidence("${name}") needs the test tagged @evidence.`);
      }
      const path = join(EVIDENCE_DIR, product, `${name}.png`);
      await mkdir(dirname(path), { recursive: true });
      await page.screenshot({ path, fullPage: true });
    });
  },
});

/**
 * A Product's `playwright.config.ts`: runs the Skeleton's E2E specs against the
 * Product's production build (`dist/<product>/wrangler.json`, served by
 * `createTestHarness()`) on a migrated Postgres (`DATABASE_URL` or a container).
 */
export function defineE2EConfig({
  product,
  dir,
  messages,
}: {
  product: string;
  dir: string;
  messages?: MessageOverrides;
}) {
  process.env[PRODUCT_DIR_ENV] = dir;
  const t = messagesFor(resolveLocale(process.env.LOCALE), messages);
  return defineConfig<E2EOptions>({
    testDir: fileURLToPath(new URL("./specs", import.meta.url)),
    globalSetup: fileURLToPath(new URL("./global-setup.ts", import.meta.url)),
    outputDir: join(dir, "test-results/playwright"),
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: join(dir, "playwright-report") }]] : "list",
    use: { product, t, trace: "retain-on-failure" },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  });
}
