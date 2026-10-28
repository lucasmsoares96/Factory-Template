import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { catalog, LANGUAGES } from "../src/messages.ts";

describe("message catalog", () => {
  it("has every fixed text in every language", () => {
    const missing = Object.entries(catalog).flatMap(([key, entry]) =>
      LANGUAGES.filter((language) => typeof (entry as Partial<Record<string, unknown>>)[language] !== "function").map((language) => `${key}: ${language}`),
    );
    expect(missing).toEqual([]);
  });

  it("FACTORY_LANGUAGE picks the language; English when it is not set", () => {
    expect(loadConfig({}).language).toBe("en");
    expect(loadConfig({ FACTORY_LANGUAGE: "pt-BR" }).language).toBe("pt-BR");
    expect(() => loadConfig({ FACTORY_LANGUAGE: "fr" })).toThrow(/FACTORY_LANGUAGE/);
  });
});
