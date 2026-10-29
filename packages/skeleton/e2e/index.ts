import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices, test as base, type APIRequestContext } from "@playwright/test";
import { messagesFor, resolveLocale, type MessageOverrides, type Messages } from "../src/i18n/index.ts";
import { linkIn } from "../src/node/email-link.ts";
import type { SentEmail } from "../src/node/resend-mock.ts";

export { expect } from "@playwright/test";
export { linkIn };

/**
 * Puts the signed-in user on the Product's biggest fixed Plan through the local Checkout, so they
 * have Seats to invite with. Does nothing where the Product has no billing (`GET /api/billing/plan` answers 404).
 */
export async function buyPlan(request: APIRequestContext, origin: string) {
  const state = await request.get("/api/billing/plan");
  if (state.status() === 404) return;
  if (!state.ok()) throw new Error(`Reading the Plan answered ${state.status()}: is the user signed in?`);
  const { plans } = (await state.json()) as { plans: { id: string; kind: string; seats: number | null }[] };
  const biggest = plans.filter((plan) => plan.kind === "fixed").sort((a, b) => (b.seats ?? 0) - (a.seats ?? 0))[0];
  if (!biggest) throw new Error("The Product sells no fixed Plan to buy Seats with.");
  const checkout = await request.post("/api/billing/subscribe", { headers: { origin }, data: { plan: biggest.id } });
  if (!checkout.ok()) throw new Error(`Opening Checkout failed with ${checkout.status()}.`);
  const { url } = (await checkout.json()) as { url: string };
  const paid = await request.post(`${new URL(url).pathname}/pay`, { maxRedirects: 0 });
  if (paid.status() !== 303) throw new Error(`Paying in Checkout answered ${paid.status()}.`);
}

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
/** Set by the global setup: where the emails the Worker sent through (intercepted) Resend land. */
export const MAILBOX_DIR_ENV = "SKELETON_E2E_MAILBOX_DIR";

/** The emails the Worker sent during the run. */
export type Mailbox = {
  /**
   * The newest email to `to` (with `subject`, if given), waiting for it to
   * arrive (emails go out after the response).
   */
  latest(to: string, options?: { subject?: string; timeout?: number }): Promise<SentEmail>;
};

function mailboxIn(folder: string): Mailbox {
  return {
    async latest(to, { subject, timeout = 10_000 } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const files = (await readdir(folder)).filter((file) => file.endsWith(".json")).sort().reverse();
        for (const file of files) {
          const email = JSON.parse(await readFile(join(folder, file), "utf8")) as SentEmail;
          if (email.to.includes(to) && (subject === undefined || email.subject === subject)) return email;
        }
        if (Date.now() > deadline) {
          throw new Error(`No email to ${to}${subject ? ` with subject "${subject}"` : ""} within ${timeout} ms.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    },
  };
}

type E2EOptions = {
  /** The Product's id: names its evidence folder. */
  product: string;
  /** The build locale's texts with the Product's overrides: what the screens show. */
  t: Messages;
};

/**
 * The Skeleton's E2E test. Locate elements by role + i18n text (`t`) or
 * `data-testid`. Tag a test `@evidence` and call `evidence(name)` to save the
 * print the Factory posts on the PR. `mailbox` reads the emails the Worker sent.
 */
export const test = base.extend<{ evidence: (name: string) => Promise<void>; mailbox: Mailbox }, E2EOptions>({
  product: ["", { option: true, scope: "worker" }],
  t: [messagesFor("en"), { option: true, scope: "worker" }],
  // Playwright reads a fixture's dependencies from this (empty) pattern.
  // oxlint-disable-next-line no-empty-pattern
  baseURL: async ({}, use) => {
    const url = process.env[BASE_URL_ENV];
    if (!url) throw new Error(`${BASE_URL_ENV} is not set: run the E2E through defineE2EConfig.`);
    await use(url);
  },
  // Better Auth limits requests per client IP (`cf-connecting-ip`, which Cloudflare
  // sets and the local runtime keeps when the client sends it): each test is its
  // own visitor, so one test's attempts never block another's.
  // oxlint-disable-next-line no-empty-pattern
  extraHTTPHeaders: async ({}, use) => {
    const ip = `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 256)).join(".")}`;
    await use({ "cf-connecting-ip": ip });
  },
  // oxlint-disable-next-line no-empty-pattern
  mailbox: async ({}, use) => {
    const folder = process.env[MAILBOX_DIR_ENV];
    if (!folder) throw new Error(`${MAILBOX_DIR_ENV} is not set: run the E2E through defineE2EConfig.`);
    await use(mailboxIn(folder));
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
 * A Product's `playwright.config.ts`: runs the Skeleton's E2E specs and the
 * Product's own (`apps/<id>/e2e/`) against the Product's production build (`dist/<product>/wrangler.json`, served by
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
    globalSetup: fileURLToPath(new URL("./global-setup.ts", import.meta.url)),
    outputDir: join(dir, "test-results/playwright"),
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: join(dir, "playwright-report") }]] : "list",
    use: { product, t, trace: "retain-on-failure" },
    // Two projects, one browser: the Skeleton's specs (every Product runs them) and the Product's own in `<dir>/e2e/`.
    projects: [
      { name: "skeleton", testDir: fileURLToPath(new URL("./specs", import.meta.url)), use: { ...devices["Desktop Chrome"] } },
      { name: "product", testDir: join(dir, "e2e"), use: { ...devices["Desktop Chrome"] } },
    ],
  });
}
