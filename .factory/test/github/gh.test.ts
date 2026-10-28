import { describe, expect, it } from "vitest";
import { runGh } from "../../src/adapters/github/gh.ts";
import { tempDir } from "../helpers.ts";
import { fakeGh, type FakeGhOutput } from "./fake-gh.ts";

describe("runGh", () => {
  it("gives gh exactly the env it is passed, none of the parent's secrets, and writes the input to stdin", async () => {
    const bin = await fakeGh();
    process.env.FACTORY_TEST_SECRET = "parent-secret";
    try {
      const out = JSON.parse(await runGh(["api", "user"], { env: { PATH: bin, GH_TOKEN: "tok" }, input: "body" })) as FakeGhOutput;

      expect(out.args).toEqual(["api", "user"]);
      expect(out.input).toBe("body");
      expect(out.env.GH_TOKEN).toBe("tok");
      expect(out.env.PATH).toBe(bin);
      expect(out.env.FACTORY_TEST_SECRET).toBeUndefined();
      expect(out.env.HOME).toBeUndefined();
    } finally {
      delete process.env.FACTORY_TEST_SECRET;
    }
  });

  it("closes stdin when there is no input, so gh does not wait on it", async () => {
    const bin = await fakeGh();

    const out = JSON.parse(await runGh(["api", "user"], { env: { PATH: bin }, input: undefined })) as FakeGhOutput;

    expect(out.input).toBe("");
  });

  it("rejects with gh's stderr", async () => {
    const bin = await fakeGh();
    await expect(runGh(["fail", "x"], { env: { PATH: bin } })).rejects.toThrow("gh fail x failed: HTTP 403: nope");
  });

  it("says how to install gh when it is not on PATH", async () => {
    const empty = await tempDir("no-gh-");
    await expect(runGh(["api", "user"], { env: { PATH: empty } })).rejects.toThrow("https://cli.github.com");
  });
});
