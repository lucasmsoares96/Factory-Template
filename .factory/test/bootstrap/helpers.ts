import { defaultConfig, loadConfig } from "../../src/config.ts";
import { runBootstrap, type BootstrapDeps } from "../../src/bootstrap/cli.ts";
import { FakeCloudflare, FakeGitHub, FakeNeon, FakePrompter, FakeResend } from "../../src/bootstrap/fake/fakes.ts";

export const TOKEN = "good-token";

export function world(answers: Record<string, string | boolean> = {}, env: Record<string, string | undefined> = {}) {
  const github = new FakeGitHub();
  const cloudflare = new FakeCloudflare();
  const prompter = new FakePrompter({ "cloudflare-token": TOKEN, "workers-dev-subdomain": "my-team", ...answers });
  const lines: string[] = [];
  const deps: BootstrapDeps = {
    github,
    cloudflare: (token) => cloudflare.forToken(token),
    neon: new FakeNeon(),
    resend: new FakeResend(),
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
  return { github, cloudflare, prompter, lines, deps, run };
}

export const staticLabelNames = Object.entries(defaultConfig.labels)
  .filter(([key]) => key !== "productPrefix")
  .map(([, name]) => name);
