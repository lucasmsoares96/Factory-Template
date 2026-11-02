import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import { startDev } from "../src/node/dev.ts";

// Seam 1: the dev command with fake processes.

class FakeProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;
  kill() {
    this.killed = true;
    this.exitCode = 143;
    this.emit("exit", 143);
    return true;
  }
}
type Call = { command: string; args: string[]; env?: NodeJS.ProcessEnv; process: FakeProcess };

function harness(env: NodeJS.ProcessEnv = {}) {
  const calls: Call[] = [];
  const exits: number[] = [];
  const logs: string[] = [];
  const spawn = ((command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    const process = new FakeProcess();
    calls.push({ command, args, env: options.env, process });
    return process;
  }) as never;
  const run = (stripe: boolean) =>
    startDev({ dir: "/app", env, databaseUrl: "postgres://db", stripe, spawn, exit: (code) => exits.push(code), log: (m) => logs.push(m) });
  return { calls, exits, logs, run };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("without --stripe, Vite runs on the fake Stripe and ignores a key in the environment", async () => {
  const h = harness({ STRIPE_SECRET_KEY: "sk_live_x", BILLING_ENVIRONMENT: "pr-1" });
  await h.run(false);
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0]!.command).toBe("vite");
  expect(h.calls[0]!.env).toMatchObject({ STRIPE_FAKE: "true", DATABASE_URL: "postgres://db" });
  expect(h.calls[0]!.env).not.toHaveProperty("STRIPE_SECRET_KEY");
  expect(h.calls[0]!.env).not.toHaveProperty("BILLING_ENVIRONMENT");
});

test.each([[undefined, /needs STRIPE_SECRET_KEY/], ["sk_live_abc", /live key/], ["rk_live_abc", /live key/], ["abc", /not a sandbox key/]])(
  "--stripe with the key %s starts nothing",
  async (key, message) => {
    const h = harness(key ? { STRIPE_SECRET_KEY: key } : {});
    await expect(h.run(true)).rejects.toThrow(message);
    expect(h.calls).toHaveLength(0);
  },
);

test("--stripe starts stripe listen, then Vite with the secret it printed", async () => {
  const h = harness({ STRIPE_SECRET_KEY: "rk_test_abc" });
  const started = h.run(true);
  await tick();
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0]!.args).toEqual([
    "exec", "stripe", "listen", "--api-key", "rk_test_abc", "--forward-to", "localhost:5173/api/auth/stripe/webhook",
  ]);
  h.calls[0]!.process.stderr.write("> Ready! Your webhook signing secret is whsec_abc123 (^C to quit)\n");
  await started;
  expect(h.calls).toHaveLength(2);
  expect(h.calls[1]!.args).toEqual(["dev", "--port", "5173", "--strictPort"]);
  expect(h.calls[1]!.env).toMatchObject({
    STRIPE_FAKE: "false",
    BILLING_ENVIRONMENT: "local",
    STRIPE_SECRET_KEY: "rk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_abc123",
  });
});

test("if Vite ends, stripe listen is stopped, and the other way round", async () => {
  for (const first of [1, 0]) {
    const h = harness({ STRIPE_SECRET_KEY: "sk_test_abc" });
    const started = h.run(true);
    await tick();
    h.calls[0]!.process.stdout.write("Ready! Your webhook signing secret is whsec_x\n");
    await started;
    h.calls[first]!.process.kill();
    expect(h.calls[1 - first]!.process.killed).toBe(true);
    expect(h.exits).toHaveLength(1);
    expect(h.logs.join()).toMatch(/stopping/);
  }
});

test("if stripe listen ends before printing a secret, nothing else starts", async () => {
  const h = harness({ STRIPE_SECRET_KEY: "sk_test_abc" });
  const started = h.run(true);
  await tick();
  h.calls[0]!.process.emit("exit", 1);
  await started;
  expect(h.calls).toHaveLength(1);
  expect(h.exits).toEqual([1]);
});
