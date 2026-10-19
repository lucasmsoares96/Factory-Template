import type { Adapters } from "../commands/context.ts";
import type { FactoryConfig } from "../config.ts";

/**
 * Builds the real adapters selected by `FACTORY_ADAPTERS`:
 * `local` (Markdown Tracker, local CodeHost, Sandcastle, factory:verify; ticket 10)
 * and `github` (ticket 16). Tests inject the fakes instead.
 */
export function adaptersFromEnv(
  env: Record<string, string | undefined>,
  _input: { config: FactoryConfig; repo: string },
): Adapters {
  const kind = env.FACTORY_ADAPTERS;
  throw new Error(
    kind
      ? `FACTORY_ADAPTERS=${kind} is not available yet. Known values: local (ticket 10), github (ticket 16).`
      : "Set FACTORY_ADAPTERS to choose the Tracker, CodeHost, Agent and Verify adapters.",
  );
}
