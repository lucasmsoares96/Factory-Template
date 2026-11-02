// The processes behind `skeleton dev`: Vite (the Worker and the SPA), and with
// `--stripe` the Stripe CLI forwarding a real sandbox's webhooks to localhost.
import type { ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// `@stripe/cli` is a dependency of the Skeleton, so its `stripe` binary resolves from here
// (not from a Product's directory).
const SKELETON_DIR = fileURLToPath(new URL("../..", import.meta.url));

export const DEV_PORT = 5173;
export const WEBHOOK_PATH = "/api/auth/stripe/webhook";

type Spawn = typeof nodeSpawn;

/** Returns the key when it is a sandbox key, else throws with what to do. */
export function sandboxKey(key: string | undefined): string {
  if (!key) {
    throw new Error(
      "pnpm dev --stripe needs STRIPE_SECRET_KEY, the key of a Stripe sandbox (use the Previews' sandbox: it has the Product's Plans).\n" +
        "Create a restricted key there (Developers > API keys), then: read -s -p \"Stripe sandbox key: \" STRIPE_SECRET_KEY; export STRIPE_SECRET_KEY",
    );
  }
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    throw new Error("STRIPE_SECRET_KEY is a live key. pnpm dev --stripe only accepts a sandbox key (sk_test_ or rk_test_).");
  }
  if (!/^(sk|rk)_test_/.test(key)) {
    throw new Error("STRIPE_SECRET_KEY is not a sandbox key. pnpm dev --stripe only accepts sk_test_ or rk_test_ keys.");
  }
  return key;
}

/** The signing secret in a line of `stripe listen` output, if any. */
export function webhookSecret(text: string): string | undefined {
  return /Your webhook signing secret is (whsec_\w+)/.exec(text)?.[1];
}

export interface DevOptions {
  dir: string;
  env: NodeJS.ProcessEnv;
  databaseUrl: string;
  stripe: boolean;
  spawn: Spawn;
  /** Called once with the exit code when the command ends. */
  exit: (code: number) => void;
  log?: (message: string) => void;
}

/** Starts the dev processes. Check the key before anything else is started. */
export async function startDev({ dir, env, databaseUrl, stripe, spawn, exit, log = console.error }: DevOptions) {
  const key = stripe ? sandboxKey(env.STRIPE_SECRET_KEY) : undefined;
  // With `secrets` in wrangler.jsonc, the Worker reads its required secrets and
  // overrides its vars from the environment. Emails land in the outbox table.
  const base: NodeJS.ProcessEnv = {
    ...env,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET ?? "local-dev-secret-never-used-in-production",
    EMAIL_TRANSPORT: "outbox",
  };
  // The fake Stripe never runs next to a real key.
  delete base.STRIPE_SECRET_KEY;
  delete base.STRIPE_WEBHOOK_SECRET;
  delete base.BILLING_ENVIRONMENT;

  if (!key) {
    // Billing runs on a Stripe that lives in the Worker: no internet, no real key.
    const vite = spawn("vite", ["dev"], { cwd: dir, stdio: "inherit", env: { ...base, STRIPE_FAKE: "true" } });
    vite.on("exit", (code) => exit(code ?? 0));
    return;
  }

  let done = false;
  const children: ChildProcess[] = [];
  const stop = (code: number, message?: string) => {
    if (done) return;
    done = true;
    if (message) log(message);
    for (const child of children) if (child.exitCode === null) child.kill();
    exit(code);
  };

  // Ending the command (Ctrl+C, kill) ends both processes.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => stop(130, `${signal} received; stopping.`));
  }

  const listen = spawn(
    "pnpm",
    ["exec", "stripe", "listen", "--forward-to", `localhost:${DEV_PORT}${WEBHOOK_PATH}`],
    {
      cwd: SKELETON_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      // The key goes by environment, not argv: arguments are visible to every process on the machine.
      env: { PATH: env.PATH, HOME: env.HOME, STRIPE_API_KEY: key },
    },
  );
  children.push(listen);
  listen.on("exit", (code) => stop(code ?? 1, "stripe listen ended; stopping."));
  listen.on("error", (error) => stop(1, `stripe listen failed to start: ${error.message}`));

  const secret = await new Promise<string | undefined>((resolveSecret) => {
    let seen = "";
    const read = (chunk: Buffer | string) => {
      const text = chunk.toString();
      process.stderr.write(text);
      seen += text;
      const found = webhookSecret(seen);
      if (found) resolveSecret(found);
    };
    listen.stdout?.on("data", read);
    listen.stderr?.on("data", read);
    listen.on("exit", () => resolveSecret(undefined));
    listen.on("error", () => resolveSecret(undefined));
  });
  if (!secret) {
    stop(1, "stripe listen did not print a webhook signing secret.");
    return;
  }

  const vite = spawn("vite", ["dev", "--port", String(DEV_PORT), "--strictPort"], {
    cwd: dir,
    stdio: "inherit",
    env: {
      ...base,
      STRIPE_FAKE: "false",
      SKELETON_DEV_STRIPE: "true",
      BILLING_ENVIRONMENT: "local",
      STRIPE_SECRET_KEY: key,
      STRIPE_WEBHOOK_SECRET: secret,
    },
  });
  children.push(vite);
  vite.on("exit", (code) => stop(code ?? 0, "vite ended; stopping stripe listen."));
  return { stop };
}
