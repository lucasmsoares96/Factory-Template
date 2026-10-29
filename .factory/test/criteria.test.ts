import { describe, expect, it } from "vitest";
import { checkCriteria, countCriteria } from "../src/criteria.ts";

const BODY = [
  "## What to build",
  "",
  "- [ ] not a criterion",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] one",
  "* [X] two",
  "  - [ ] nested",
  "- plain item",
  "",
  "### Notes",
  "",
  "- [ ] after the section",
  "",
].join("\r\n");

describe("the acceptance criteria section", () => {
  it("checks only the boxes between its heading and the next heading, leaving every other byte as it was", () => {
    const out = checkCriteria(BODY);

    expect(out).toBe(BODY.replace("- [ ] one", "- [x] one").replace("  - [ ] nested", "  - [x] nested"));
  });

  it("counts the checkbox items of the section only", () => {
    expect(countCriteria(BODY)).toBe(3);
    expect(countCriteria("no section\n- [ ] x")).toBe(0);
  });

  it("returns the body untouched when there is no section", () => {
    expect(checkCriteria("- [ ] x\n")).toBe("- [ ] x\n");
  });
});
