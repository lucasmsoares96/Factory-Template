import { defaultConfig, loadConfig } from "../../src/config.ts";
import { runBootstrap, type BootstrapDeps } from "../../src/bootstrap/cli.ts";
import type { ProductIdentity } from "../../src/bootstrap/steps.ts";
import { FakeAccounts, FakeCloudflare, FakeGitHub, FakeMachineUsers, FakeNeon, FakePrompter, FakeResend, FakeWrangler } from "../../src/bootstrap/fake/fakes.ts";

export const TOKEN = "good-token";

export const WRANGLER_TOKEN = "wrangler-oauth-token";

/** `wranglerToken`: what wrangler has saved (none = not logged in; `login()` then saves WRANGLER_TOKEN). */
export function world(answers: Record<string, string | boolean | string[]> = {}, env: Record<string, string | undefined> = {}, wranglerToken?: string) {
  const github = new FakeGitHub();
  const machines = new FakeMachineUsers(github);
  const cloudflare = new FakeCloudflare();
  const resend = new FakeResend();
  const neon = new FakeNeon();
  const wrangler = new FakeWrangler(wranglerToken);
  cloudflare.validTokens.add(WRANGLER_TOKEN);
  const accounts = new FakeAccounts();
  const products = new Map<string, ProductIdentity>([
    ["example", { id: "example", title: "Example", emailFrom: "Example <no-reply@example.com>", domain: "example.com" }],
  ]);
  const prompter = new FakePrompter({ "cloudflare-token": TOKEN, "workers-dev-subdomain": "my-team", ...answers });
  const lines: string[] = [];
  const deps: BootstrapDeps = {
    github,
    cloudflare: (token) => cloudflare.forToken(token),
    wrangler,
    neon: (options) => neon.forSession(options),
    accounts,
    machine: (token) => machines.forToken(token),
    resend: (key) => resend.forKey(key),
    product: async (id) => {
      const found = products.get(id);
      if (!found) throw new Error(`No Product at apps/${id}/product.config.ts`);
      return found;
    },
    sleep: async () => {},
    prompter,
    env,
    log: (line) => lines.push(line),
    config: loadConfig({}),
  };
  const run = async (...argv: string[]) => {
    lines.length = 0;
    const code = await runBootstrap(argv, deps);
    return { code, output: lines.join("\n") };
  };
  return { github, machines, cloudflare, wrangler, resend, neon, accounts, products, prompter, lines, deps, run };
}

export const staticLabelNames = Object.entries(defaultConfig.labels)
  .filter(([key]) => key !== "productPrefix")
  .map(([, name]) => name);
