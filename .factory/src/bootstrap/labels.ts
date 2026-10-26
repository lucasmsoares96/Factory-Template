import type { FactoryConfig } from "../config.ts";
import type { LabelSpec } from "./clients.ts";

type StaticLabelKey = Exclude<keyof FactoryConfig["labels"], "productPrefix">;

/** Colour and description of each label; the name comes from `config.ts`. */
const METADATA: Record<StaticLabelKey, { color: string; description: string }> = {
  needsTriage: { color: "d4c5f9", description: "Maintainer needs to evaluate this issue" },
  needsInfo: { color: "fbca04", description: "Waiting on the reporter for more information" },
  readyForAgent: { color: "0e8a16", description: "Fully specified, ready for an AFK agent" },
  readyForHuman: { color: "1d76db", description: "Requires human implementation" },
  wontfix: { color: "ffffff", description: "Will not be actioned" },
  inProgress: { color: "5319e7", description: "The Factory holds the lock on this issue" },
  agentExplore: { color: "c5def5", description: "Ask the Factory to triage: it explores and comments, no code" },
  harnessChange: { color: "b60205", description: "Touches the harness: review with care" },
  preview: { color: "bfdadc", description: "The pull request has a preview deployment" },
  retro: { color: "fef2c0", description: "Proposals from the automatic Retro: pick what becomes work" },
};

/** Every label the common part creates. `product:<id>` is per Product (`bootstrap product`). */
export function labelSpecs(config: FactoryConfig): LabelSpec[] {
  return (Object.keys(METADATA) as StaticLabelKey[]).map((key) => ({ name: config.labels[key], ...METADATA[key] }));
}
