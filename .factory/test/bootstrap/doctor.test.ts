import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { configSchema, variableName } from "../../src/config.ts";
import { TOKEN, world } from "./helpers.ts";

/** The values a leaf of the config schema accepts from a repo variable, when they are a closed list. */
function closedValues(schema: z.ZodType): string[] {
  const def = schema.def as { type: string; entries?: Record<string, string>; options?: z.ZodType[]; in?: z.ZodType };
  if (def.type === "enum") return Object.values(def.entries!);
  if (def.type === "union") return def.options!.flatMap(closedValues);
  if (def.type === "pipe") return closedValues(def.in!);
  return [];
}

/** Every `FACTORY_*` variable whose setting is a closed list of values, read from the schema itself. */
function closedLeaves(shape: Record<string, z.ZodType>, path: string[] = []): { name: string; values: string[] }[] {
  return Object.entries(shape).flatMap(([key, schema]) => {
    const at = [...path, key];
    if (schema.def.type === "object") return closedLeaves((schema as z.ZodObject).shape, at);
    const values = closedValues(schema);
    return values.length > 0 ? [{ name: variableName(at), values }] : [];
  });
}

describe("pnpm bootstrap doctor", () => {
  it("fails on an empty repo and lists what is missing, writing nothing", async () => {
    const w = world();

    const { code, output } = await w.run("doctor");

    expect(code).toBe(1);
    expect(output).toContain("CLOUDFLARE_API_TOKEN");
    expect(output).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(output).toContain("ready-for-agent");
    expect(w.github.writes + w.cloudflare.writes).toBe(0);
    expect(w.prompter.asked).toEqual([]);
  });

  it("passes after the wizard and shows what is still switched off", async () => {
    const w = world();
    await w.run();

    const { code, output } = await w.run("doctor");

    expect(code).toBe(0);
    expect(output).toMatch(/off\s+DEPLOY_ENABLED/);
    expect(output).toMatch(/off\s+PREVIEWS_ENABLED/);
    expect(output).toMatch(/off\s+FACTORY_ENABLED/);
  });

  it("shows the language of the Factory's public text, and that it is unset", async () => {
    const w = world({ "factory-language": "pt-BR" });
    expect((await w.run("doctor")).output).toMatch(/ok\s+FACTORY_LANGUAGE.*not set: the Factory writes in en; `pnpm bootstrap` asks it/);

    await w.run();

    expect((await w.run("doctor")).output).toMatch(/ok\s+FACTORY_LANGUAGE.*pt-BR/);
  });

  it("warns about a language the Factory does not know", async () => {
    const w = world();
    w.github.variables.set("FACTORY_LANGUAGE", "pt");
    expect((await w.run("doctor")).output).toMatch(/warn\s+FACTORY_LANGUAGE.*pt is not one of en, pt-BR: every Factory job fails; run `pnpm bootstrap --redo language`/);
  });

  it("warns about a value outside the closed list of every such setting, with the accepted values", async () => {
    const leaves = closedLeaves(configSchema.shape);
    expect(leaves.map((l) => l.name)).toEqual(expect.arrayContaining(["FACTORY_LANGUAGE", "FACTORY_MERGE_MODE", "FACTORY_RETRO_ENABLED"]));

    for (const { name, values } of leaves) {
      const w = world();
      w.github.variables.set(name, "not-a-value");

      const { output } = await w.run("doctor");

      expect(output).toMatch(new RegExp(`warn\\s+${name}\\s+not-a-value is not one of ${values.join(", ")}: every Factory job fails`));
    }
  });

  it("shows a closed setting that is unset or valid as ok", async () => {
    const w = world();
    expect((await w.run("doctor")).output).toMatch(/ok\s+FACTORY_RETRO_ENABLED\s+not set: true/);

    w.github.variables.set("FACTORY_RETRO_ENABLED", "false");

    expect((await w.run("doctor")).output).toMatch(/ok\s+FACTORY_RETRO_ENABLED\s+false/);
  });

  it("shows a module as on when its variable is true", async () => {
    const w = world();
    await w.run();
    w.github.variables.set("DEPLOY_ENABLED", "true");

    const { output } = await w.run("doctor");

    expect(output).toMatch(/ok\s+DEPLOY_ENABLED/);
  });

  it("warns when both Claude auths exist", async () => {
    const w = world();
    await w.run();
    w.github.secrets.set("CLAUDE_CODE_OAUTH_TOKEN", "x");
    w.github.secrets.set("ANTHROPIC_API_KEY", "y");

    const { output } = await w.run("doctor");

    expect(output).toMatch(/warn\s+Claude auth/);
    expect(output).toContain("ANTHROPIC_API_KEY wins");
  });

  it("notes that the secrets fall back to the repo when environments are unavailable", async () => {
    const w = world();
    await w.run();
    w.github.variables.set("FACTORY_USE_ENVIRONMENTS", "false");

    const { output } = await w.run("doctor");

    expect(output).toMatch(/off\s+Environments/);
  });

  it("checks workers.dev when the token is in the environment, and flags a missing one", async () => {
    const w = world({}, { CLOUDFLARE_API_TOKEN: TOKEN });
    await w.run();
    w.cloudflare.subdomains.clear();

    const { code, output } = await w.run("doctor");

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+workers\.dev/);
    expect(w.cloudflare.writes).toBe(1);
  });

  it("does not re-check workers.dev without a saved Cloudflare login, and says the secrets stand in", async () => {
    const w = world();
    await w.run();

    const { output } = await w.run("doctor");

    expect(output).toMatch(/ok\s+workers\.dev\s+not re-checked \(no saved Cloudflare login/);
  });

  it("reports a permission that cannot manage the repo", async () => {
    const w = world();
    await w.run();
    w.github.info = { ...w.github.info, viewerPermission: "WRITE" };

    const { code, output } = await w.run("doctor");

    expect(code).toBe(1);
    expect(output).toMatch(/missing\s+Repo permission/);
  });

  it("does not need DNS or zone permission to be ok", async () => {
    const w = world({}, { CLOUDFLARE_API_TOKEN: TOKEN });
    await w.run();
    w.cloudflare.deny(TOKEN, "dns", "zone");

    const { code, output } = await w.run("doctor");

    expect(code).toBe(0);
    expect(output).toMatch(/ok\s+workers\.dev/);
  });
});
