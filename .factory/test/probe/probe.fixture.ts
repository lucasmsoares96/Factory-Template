import { expect, it } from "vitest";
import { checkout, commitFile, derivedCheckout, tempDir } from "../helpers.ts";

// Not a test of the harness: `temp-hygiene.test.ts` runs this file in a child vitest with a private TMPDIR.
it("uses every kind of temp dir and passes", async () => {
  await tempDir("factory-artifacts-");
  await checkout();
  await derivedCheckout("probe", (dir) => commitFile(dir, "probe.txt", "x\n", "chore: probe"));
});

it("uses temp dirs and fails", async () => {
  await tempDir("factory-out-");
  await checkout();
  expect(1).toBe(2);
});
