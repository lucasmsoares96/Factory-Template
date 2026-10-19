import { describe, expect, it } from "vitest";
import { diffLines } from "../src/diff.ts";
import { Git } from "../src/git.ts";
import { checkout, git } from "./helpers.ts";

describe("diffLines", () => {
  it("reports a renamed file under its new path, with only the changed lines", async () => {
    const repo = await checkout();
    await git(repo, "checkout", "--quiet", "-b", "rename");
    await git(repo, "mv", "src/app.ts", "src/renamed.ts");
    await git(repo, "commit", "--quiet", "-m", "move");
    const lines = await diffLines(new Git(repo), "main", "rename");
    // A pure rename has no hunk; with rename detection it would be dropped silently, here it is a delete + add.
    expect([...lines.keys()]).toEqual(["src/renamed.ts"]);
    expect(lines.get("src/renamed.ts")!.size).toBe(30);
  });
});
