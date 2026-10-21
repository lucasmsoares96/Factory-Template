import { describe, expect, it } from "vitest";
import { factoryEnvLines } from "../src/ci/vars.ts";

describe("ci vars: the repo variables that override the Factory settings", () => {
  it("keeps the config variables and the machine user, and nothing else", () => {
    const vars = JSON.stringify({
      FACTORY_MAX_ATTEMPTS: "3",
      FACTORY_LABELS_IN_PROGRESS: "doing",
      FACTORY_MACHINE_USER: "bot",
      FACTORY_ENABLED: "true",
      FACTORY_RUNNER: "self-hosted",
      NODE_OPTIONS: "--require /tmp/x.js",
      FACTORY_TOKEN: "leak",
    });

    expect(factoryEnvLines(vars)).toEqual(["FACTORY_LABELS_IN_PROGRESS=doing", "FACTORY_MACHINE_USER=bot", "FACTORY_MAX_ATTEMPTS=3"]);
  });

  it("skips empty values and values with a line break (they could inject another variable)", () => {
    expect(factoryEnvLines(JSON.stringify({ FACTORY_MAX_ATTEMPTS: "", FACTORY_MACHINE_USER: "bot\nNODE_OPTIONS=x" }))).toEqual([]);
  });

  it("an unset or malformed vars context gives nothing", () => {
    expect(factoryEnvLines("")).toEqual([]);
    expect(factoryEnvLines("{nope")).toEqual([]);
  });
});
