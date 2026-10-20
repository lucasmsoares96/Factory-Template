type Env = Record<string, string | undefined>;

/** Claude Code's auth variables: the only secrets a session or the work container gets. */
export const CLAUDE_AUTH = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];

/** What any child process needs to find its tools and behave; never a secret. */
export const BASE_ENV = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "USER", "SHELL", "PNPM_HOME"];

/**
 * The only variables an agent session sees: tools, Claude's auth, the E2E
 * database and CI. Everything else in the job's env (forge tokens, cloud keys,
 * NODE_OPTIONS...) stays out, because issue content becomes the prompt.
 */
export const AGENT_ENV_ALLOWLIST = ["PATH", "HOME", ...CLAUDE_AUTH, "DATABASE_URL", "CI"];

/** Variables for `pnpm factory:verify`: tools, the E2E database, CI, Turbo and Playwright settings; no auth of any kind. */
export const VERIFY_ENV = [...BASE_ENV, "DATABASE_URL", "CI"];
export const VERIFY_ENV_PREFIXES = ["TURBO_", "PLAYWRIGHT_"];

/** The entries of `env` named in `keys` (or starting with one of `prefixes`) that are set. */
export function pick(env: Env, keys: readonly string[], prefixes: readonly string[] = []): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) =>
      value !== undefined && (keys.includes(key) || prefixes.some((p) => key.startsWith(p))) ? [[key, value]] : [],
    ),
  );
}
