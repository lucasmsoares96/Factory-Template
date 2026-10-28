import { z } from "zod";
import { LANGUAGES } from "./messages.ts";

/**
 * Factory settings. Every leaf can be overridden by a repo variable named
 * after its path: `maxAttempts` → `FACTORY_MAX_ATTEMPTS`,
 * `timeouts.development` → `FACTORY_TIMEOUTS_DEVELOPMENT`,
 * `labels.inProgress` → `FACTORY_LABELS_IN_PROGRESS`.
 */
export const defaultConfig = {
  /** Sonnet in Development, Review and Retro; Haiku in Triage and Pull Request. Checked against the Claude model list on 2026-10-19. */
  models: {
    development: "claude-sonnet-5-5",
    review: "claude-sonnet-5-5",
    triage: "claude-haiku-5-5",
    pullRequest: "claude-haiku-5-5",
    retro: "claude-sonnet-5-5",
  },
  /** Minutes. A Stage timeout counts as a failure; `total` leads to Escalation "time". */
  timeouts: {
    development: 60,
    review: 30,
    e2e: 20,
    pullRequest: 15,
    triage: 30,
    retro: 30,
    total: 330,
  },
  /**
   * USD per million tokens, for the estimated cost in the review, the
   * Escalation and the job summary. Claude Opus 5.5 list price, checked on
   * 2026-10-19. Used for every Stage, so it overestimates Sonnet and Haiku.
   */
  pricing: {
    inputPerMTok: 4,
    outputPerMTok: 20,
  },
  /**
   * Claude Code CLI in the Factory image (`latest` on npm, checked on
   * 2026-10-19). Part of the image tag: bumping it builds a new image.
   */
  claudeCode: {
    version: "2.1.303",
  },
  /**
   * Factory image repository; the tag is the hash of the versions. Empty:
   * `ghcr.io/<owner>/<repo>/factory` from the `origin` remote.
   */
  image: {
    name: "",
  },
  /**
   * The automatic Retro (`factory-retro.yml`): after an Escalation, and after a Factory PR that a human commented on
   * closes. It only proposes, in a `needs-triage` issue. `FACTORY_RETRO_ENABLED=false` turns it off.
   */
  retro: {
    enabled: true,
  },
  /**
   * The language of the text the Factory publishes (comments, pull requests, issues): `en` or `pt-BR`. Code, commits,
   * docs and prompts stay in English. `pnpm bootstrap` asks it once and sets `FACTORY_LANGUAGE`.
   */
  language: "en",
  /**
   * The Merge Mode: which Factory pull requests `pnpm factory merge` may merge without a human. `human`: none. `safe`:
   * those whose diff touches no `PROTECTED_PATHS`, once every merge condition holds. `all`: every one, protected paths
   * included, once the other conditions hold. `pnpm bootstrap factory` asks it (step `merge-mode`, `all` behind a typed
   * confirmation) and sets `FACTORY_MERGE_MODE`; the `FACTORY_TOKEN` cannot change a variable.
   */
  mergeMode: "human",
  /** Attempts of Development → Review → E2E before Escalation. */
  maxAttempts: 5,
  /** Open previews per Product before "preview skipped: limit reached". */
  previewLimit: 9,
  baseBranch: "main",
  /** The issue branch is `<branchPrefix><N>`. */
  branchPrefix: "factory/issue-",
  /** Where `@evidence` E2E tests write their prints: `<evidenceDir>/<product>/<name>.png`. */
  evidenceDir: "test-results/evidence",
  labels: {
    needsTriage: "needs-triage",
    needsInfo: "needs-info",
    readyForAgent: "ready-for-agent",
    readyForHuman: "ready-for-human",
    wontfix: "wontfix",
    inProgress: "in-progress",
    /** On an issue or pull request only while a Factory run works on it; `in-progress` is the lock, held until merge. */
    working: "factory:working",
    agentExplore: "agent:explore",
    harnessChange: "harness-change",
    preview: "preview",
    retro: "retro",
    /** On a pull request the Factory merged on its own (Merge Mode). */
    autoMerged: "auto-merged",
    /** One `product:<id>` label per Product. */
    productPrefix: "product:",
  },
};

/** The Merge Modes, the default first. */
export const MERGE_MODES = ["human", "safe", "all"] as const;
export type MergeMode = (typeof MERGE_MODES)[number];

/**
 * What a pull request may not touch to be merged in the `safe` Merge Mode (`all` ignores it). Not a setting: no repo variable overrides it,
 * and this file is in the list, so in `safe` the Factory cannot widen what it may merge itself (in `all` it can). An entry ending in `/` matches what
 * is under it; an entry that starts with `**` and a slash matches the rest (a file, or a folder when it ends in `/`) at any level; any other entry matches
 * itself or what is under it.
 */
export const PROTECTED_PATHS = [
  // What steers the Factory: the sensitive paths and the harness paths (`paths.ts`, ADR 0012), this file included.
  ".github/",
  ".agents/",
  ".claude/",
  "skills-lock.json",
  ".mcp.json",
  "**/AGENTS.md",
  "GLOSSARY.md",
  "CODING_STANDARDS.md",
  "docs/agents/",
  "docs/adr/",
  ".factory/",
  // The checks that gate the merge.
  "scripts/",
  "turbo.json",
  // Migrations: a published one is a one-way door.
  "**/drizzle/",
  "**/drizzle.config.ts",
  // Dependencies: manifests, the lockfile and the toolchain.
  "**/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".node-version",
  ".prototools",
  // The Skeleton reaches every Product.
  "packages/skeleton/",
] as const;

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PATHS.some((entry) => {
    if (entry.startsWith("**/")) {
      const name = entry.slice(3);
      if (name.endsWith("/")) return path.startsWith(name) || path.includes(`/${name}`);
      return path === name || path.endsWith(`/${name}`);
    }
    if (entry.endsWith("/")) return path.startsWith(entry);
    return path === entry || path.startsWith(`${entry}/`);
  });
}

const positiveInt = z.coerce.number().int().positive();
const nonEmpty = z.string().min(1);
/** A repo variable is text: `"false"` turns a switch off, `"true"` on. */
const flag = z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]);

const configSchema = z.object({
  models: z.object({ development: nonEmpty, review: nonEmpty, triage: nonEmpty, pullRequest: nonEmpty, retro: nonEmpty }),
  timeouts: z.object({ development: positiveInt, review: positiveInt, e2e: positiveInt, pullRequest: positiveInt, triage: positiveInt, retro: positiveInt, total: positiveInt }),
  pricing: z.object({ inputPerMTok: z.coerce.number().nonnegative(), outputPerMTok: z.coerce.number().nonnegative() }),
  claudeCode: z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  image: z.object({ name: z.string() }),
  retro: z.object({ enabled: flag }),
  language: z.enum(LANGUAGES),
  mergeMode: z.enum(MERGE_MODES),
  maxAttempts: positiveInt,
  previewLimit: positiveInt,
  baseBranch: nonEmpty,
  branchPrefix: nonEmpty,
  evidenceDir: nonEmpty,
  labels: z.object({
    needsTriage: nonEmpty,
    needsInfo: nonEmpty,
    readyForAgent: nonEmpty,
    readyForHuman: nonEmpty,
    wontfix: nonEmpty,
    inProgress: nonEmpty,
    working: nonEmpty,
    agentExplore: nonEmpty,
    harnessChange: nonEmpty,
    preview: nonEmpty,
    retro: nonEmpty,
    autoMerged: nonEmpty,
    productPrefix: nonEmpty,
  }),
});

export type FactoryConfig = z.infer<typeof configSchema>;

/** `labels.inProgress` → `FACTORY_LABELS_IN_PROGRESS`. */
export function variableName(path: string[]): string {
  return ["FACTORY", ...path.map((p) => p.replace(/([a-z0-9])([A-Z])/g, "$1_$2"))].join("_").toUpperCase();
}

/** Every repo variable that overrides a setting (`FACTORY_MAX_ATTEMPTS`, …). */
export function configVariables(): string[] {
  const walk = (node: Record<string, unknown>, path: string[]): string[] =>
    Object.entries(node).flatMap(([key, value]) =>
      value !== null && typeof value === "object" ? walk(value as Record<string, unknown>, [...path, key]) : [variableName([...path, key])],
    );
  return walk(defaultConfig, []);
}

/** Defaults with every `FACTORY_*` override from `env` applied and validated. */
export function loadConfig(env: Record<string, string | undefined>): FactoryConfig {
  const overlay = (node: Record<string, unknown>, path: string[]): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(node).map(([key, value]) => {
        const at = [...path, key];
        if (value !== null && typeof value === "object") return [key, overlay(value as Record<string, unknown>, at)];
        const override = env[variableName(at)];
        return [key, override === undefined || override === "" ? value : override];
      }),
    );
  const parsed = configSchema.safeParse(overlay(defaultConfig, []));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${variableName(i.path.map(String))}: ${i.message}`);
    throw new Error(`Invalid Factory configuration:\n${issues.join("\n")}`);
  }
  return parsed.data;
}

export function issueBranch(config: FactoryConfig, issue: number): string {
  return `${config.branchPrefix}${issue}`;
}
