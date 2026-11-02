import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { EVIDENCE_DIR, expect, test } from "../index.ts";
import { applyAllowances, measurePage, watchConsole, type FindingKind, type Measurements } from "../measure.ts";

const PAGE = (body: string, head = "") => `<!doctype html><html lang="en"><head><title>Fixture</title>${head}</head><body style="margin:0"><main>${body}</main></body></html>`;

test.describe("the measurements of a page", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  async function measure(page: import("@playwright/test").Page, html: string, allow: Parameters<typeof applyAllowances>[1] = []): Promise<Measurements> {
    const consoleErrors = watchConsole(page);
    await page.setContent(html);
    return measurePage(page, { name: "fixture", consoleErrors, allow });
  }
  const kinds = (m: Measurements): FindingKind[] => m.findings.map((f) => f.kind);

  test("a clean page has no finding", async ({ page }) => {
    const m = await measure(page, PAGE(`<h1>Companies</h1><p>Pick one.</p><a href="/new">New Company</a>`));

    expect(m.findings).toEqual([]);
    expect([m.width, m.height]).toEqual([1280, 800]);
  });

  test("a link over a title is an overlap that names both elements", async ({ page }) => {
    const m = await measure(page, PAGE(`<h1 style="margin:0;height:40px">Page title</h1><a href="/new" style="position:absolute;top:5px;left:10px">New Company</a>`));

    expect(kinds(m)).toEqual(["overlap"]);
    expect(m.findings[0]!.elements.map((e) => [e.role, e.name]).sort()).toEqual([
      ["heading", "Page title"],
      ["link", "New Company"],
    ]);
    expect(m.findings[0]!.elements[0]!.box).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
  });

  test("a menu open over the page is not an overlap", async ({ page }) => {
    const m = await measure(
      page,
      PAGE(`<h1 style="margin:0;height:40px">Page title</h1>
        <div role="menu" style="position:absolute;top:5px;left:10px;background:white"><button role="menuitem">Sign out</button><button role="menuitem">Settings</button></div>`),
    );

    expect(m.findings).toEqual([]);
  });

  test("a shadcn popover over the page is not an overlap, but two items of the same layer that cross are", async ({ page }) => {
    const layer = (items: string) => `<div data-slot="popover-content" style="position:absolute;top:5px;left:10px">${items}</div>`;
    const clean = await measure(page, PAGE(`<h1 style="margin:0;height:40px">Page title</h1>${layer(`<a href="/a">First</a>`)}`));
    expect(clean.findings).toEqual([]);

    const crossed = await measure(page, PAGE(layer(`<a href="/a" style="position:absolute">First</a><a href="/b" style="position:absolute">Second</a>`)));
    expect(kinds(crossed)).toEqual(["overlap"]);
  });

  test("a page wider than the window is a width overflow", async ({ page }) => {
    const m = await measure(page, PAGE(`<div style="width:1600px;height:20px">wide</div>`));

    expect(kinds(m)).toContain("horizontal-overflow");
  });

  test("text cut by a hidden overflow is clipped text", async ({ page }) => {
    const m = await measure(page, PAGE(`<div style="width:50px;overflow:hidden;white-space:nowrap">A title much longer than its box</div>`));

    expect(kinds(m)).toEqual(["clipped-text"]);
  });

  test("a button beyond the window's edge is off screen", async ({ page }) => {
    const m = await measure(page, PAGE(`<button style="position:absolute;left:1250px;width:100px">Save</button>`));

    expect(kinds(m)).toContain("off-screen");
  });

  test("an image that did not load is a broken image", async ({ page }) => {
    const m = await measure(page, PAGE(`<img alt="Logo" src="data:image/png;base64,AAAA" width="20" height="20">`));

    expect(kinds(m)).toEqual(["broken-image"]);
  });

  test("an error in the console, or a thrown one, is a console error", async ({ page }) => {
    const consoleErrors = watchConsole(page);
    await page.setContent(PAGE(`<p>Hi</p><script>console.error("boom"); setTimeout(() => { throw new Error("late") }, 0)</script>`));
    await expect.poll(() => consoleErrors().length).toBe(2);
    const m = await measurePage(page, { name: "fixture", consoleErrors });

    expect(m.findings.filter((f) => f.kind === "console-error").map((f) => f.message)).toEqual(["boom", "late"]);
  });

  test("a serious axe violation is a finding", async ({ page }) => {
    const m = await measure(page, PAGE(`<button></button><p>Hi</p>`));

    expect(m.findings.filter((f) => f.kind === "a11y").map((f) => f.message)).toEqual([expect.stringContaining("button-name")]);
  });

  test("a finding declared as an exception, with its reason, does not count", async ({ page }) => {
    const html = PAGE(`<div style="width:50px;overflow:hidden;white-space:nowrap">A title much longer than its box</div>`);
    const m = await measure(page, html, [{ kind: "clipped-text", reason: "The title is cut with an ellipsis on purpose." }]);

    expect(m.findings).toEqual([]);
    expect(m.exceptions).toMatchObject([{ kind: "clipped-text", reason: "The title is cut with an ellipsis on purpose." }]);
  });

  test("an exception may name the element it is for, and needs a reason", async ({ page }) => {
    const html = PAGE(`<div style="width:50px;overflow:hidden;white-space:nowrap">A title much longer than its box</div>`);
    const other = await measure(page, html, [{ kind: "clipped-text", element: "Something else", reason: "x" }]);
    expect(kinds(other)).toEqual(["clipped-text"]);

    expect(() => applyAllowances([], [{ kind: "overlap", reason: " " }])).toThrow(/needs a reason/);
  });
});

test("evidence(name) saves the print and the measurements at 1280 and at 390, then restores the size @evidence", async ({ page, product, evidence }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.setContent(PAGE(`<h1>Companies</h1><a href="/new">New Company</a>`));

  await evidence("measurements-fixture");

  for (const width of [1280, 390]) {
    const base = join(EVIDENCE_DIR, product, `measurements-fixture-${width}`);
    await access(`${base}.png`);
    expect(JSON.parse(await readFile(`${base}.json`, "utf8"))).toMatchObject({ name: "measurements-fixture", width, findings: [], exceptions: [] });
  }
  expect(page.viewportSize()).toEqual({ width: 1000, height: 700 });
});
