import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * The measurements `evidence()` takes at each print: facts about the page the browser already computed (boxes, scroll
 * sizes), the console and axe. They are data for the Visual Review Stage, never a failure of the test.
 */

/** The two sizes of every print: a desktop and a phone. */
export const SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
] as const;

export const FINDING_KINDS = ["overlap", "horizontal-overflow", "clipped-text", "off-screen", "broken-image", "console-error", "a11y"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FoundElement {
  role: string;
  name: string;
  box?: Box;
  /** The CSS selector axe reports, for a violation. */
  selector?: string;
}

export interface Finding {
  kind: FindingKind;
  message: string;
  elements: FoundElement[];
}

/** A finding the test declared on purpose, with its reason. */
export interface Exception extends Finding {
  reason: string;
}

/** What the test says it accepts: every finding of `kind` (and, with `element`, naming it) is an exception. */
export interface Allowance {
  kind: FindingKind;
  /** Why this is on purpose: the Visual Review and the Review read it. */
  reason: string;
  /** Narrows the exception to findings with an element whose accessible name contains this text. */
  element?: string;
}

export interface Measurements {
  name: string;
  width: number;
  height: number;
  findings: Finding[];
  exceptions: Exception[];
}

/** The console errors of a page since `watchConsole` was called. */
export function watchConsole(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // A signed-out visitor's session probe answers 401 by design.
    if (/Failed to load resource: the server responded with a status of 401/.test(text)) return;
    const url = message.location().url;
    errors.push(url && !text.includes(url) ? `${text} (${url})` : text);
  });
  return () => [...errors];
}

/** Runs in the browser: the layout checks. Self-contained, since Playwright serializes it. */
function measureLayout(): Finding[] {
  // The DOM lib is not part of this Node-side program: the browser's globals are reached untyped.
  // oxlint-disable-next-line no-explicit-any
  type El = any;
  // oxlint-disable-next-line no-explicit-any
  const win: any = globalThis;
  const doc: El = win.document;
  const getComputedStyle: (el: El) => El = win.getComputedStyle.bind(win);
  const Node: El = win.Node;
  const findings: Finding[] = [];
  const FLOATING = [
    '[role="menu"]',
    '[role="listbox"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="tooltip"]',
    ...[
      "dropdown-menu-content",
      "dropdown-menu-sub-content",
      "context-menu-content",
      "menubar-content",
      "select-content",
      "popover-content",
      "hover-card-content",
      "tooltip-content",
      "dialog-content",
      "dialog-overlay",
      "alert-dialog-content",
      "alert-dialog-overlay",
      "sheet-content",
      "sheet-overlay",
      "drawer-content",
      "drawer-overlay",
    ].map((slot) => `[data-slot="${slot}"]`),
  ].join(",");
  const INTERACTIVE = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="switch"],[role="radio"],[role="option"],[tabindex]:not([tabindex="-1"])';
  const LABELLED = "label,h1,h2,h3,h4,h5,h6,[role='heading']";
  const IMPLICIT_ROLE: Record<string, string> = { a: "link", button: "button", select: "combobox", textarea: "textbox", label: "label", img: "img", summary: "button", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading" };

  const roleOf = (el: El): string => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      return type === "checkbox" || type === "radio" ? type : type === "submit" || type === "button" ? "button" : "textbox";
    }
    return IMPLICIT_ROLE[el.tagName.toLowerCase()] ?? el.tagName.toLowerCase();
  };
  const nameOf = (el: El): string => {
    const labelledBy = el.getAttribute("aria-labelledby");
    const fromIds = labelledBy
      ?.split(/\s+/)
      .map((id: string) => doc.getElementById(id)?.textContent?.trim() ?? "")
      .join(" ")
      .trim();
    const labels = el.labels ? [...el.labels].map((l: El) => l.textContent?.trim() ?? "").join(" ") : "";
    const name = el.getAttribute("aria-label") || fromIds || labels || el.textContent?.trim() || el.getAttribute("placeholder") || el.getAttribute("alt") || el.getAttribute("title") || "";
    return name.replace(/\s+/g, " ").trim().slice(0, 80);
  };
  const boxOf = (r: { left: number; top: number; width: number; height: number }): Box => ({
    x: Math.round(r.left + win.scrollX),
    y: Math.round(r.top + win.scrollY),
    width: Math.round(r.width),
    height: Math.round(r.height),
  });
  const describe = (el: El): FoundElement => ({ role: roleOf(el), name: nameOf(el), box: boxOf(el.getBoundingClientRect()) });

  const visible = (el: El): boolean => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    for (let node: El = el; node; node = node.parentElement) {
      if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("inert")) return false;
      const s = getComputedStyle(node);
      if (s.display === "none" || s.visibility === "hidden") return false;
    }
    return true;
  };
  const ownsText = (el: El): boolean => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");

  // 1. Overlap: two visible text or interactive elements whose boxes cross, neither containing the other. An element
  //    in a floating layer (menu, popover, dialog) is compared only with the elements of the same layer.
  const candidates = new Set<El>();
  for (const el of doc.querySelectorAll(`${INTERACTIVE},${LABELLED}`)) candidates.add(el);
  for (const el of doc.body.querySelectorAll("*")) if (ownsText(el) && !["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(el.tagName)) candidates.add(el);
  const shown = [...candidates].filter(visible).map((el) => ({
    el,
    layer: el.closest(FLOATING),
    rects: [...el.getClientRects()].filter((r: El) => r.width > 1 && r.height > 1),
  }));
  const crosses = (a: El, b: El): boolean => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const overlaps: Finding[] = [];
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i]!;
      const b = shown[j]!;
      if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (!a.rects.some((ra: El) => b.rects.some((rb: El) => crosses(ra, rb)))) continue;
      overlaps.push({ kind: "overlap", message: "Two elements with text or interaction have boxes that cross, and neither contains the other.", elements: [describe(a.el), describe(b.el)] });
    }
  }
  findings.push(...overlaps.slice(0, 20));

  // 2. Width overflow: the page scrolls sideways.
  const viewportWidth = win.innerWidth;
  if (doc.documentElement.scrollWidth > viewportWidth) {
    const wide = [...doc.body.querySelectorAll("*")].filter((el) => visible(el) && el.getBoundingClientRect().right > viewportWidth + 1).slice(0, 5);
    findings.push({
      kind: "horizontal-overflow",
      message: `The page is ${doc.documentElement.scrollWidth}px wide in a ${viewportWidth}px window.`,
      elements: wide.map(describe),
    });
  }

  // 3. Clipped text: an element that hides its overflow while its content is bigger than its box.
  for (const el of [...doc.body.querySelectorAll("*")].filter((e) => visible(e) && (e.textContent ?? "").trim() !== "")) {
    const style = getComputedStyle(el);
    const hides = (v: string) => v === "hidden" || v === "clip";
    if (!hides(style.overflowX) && !hides(style.overflowY)) continue;
    const cutX = hides(style.overflowX) && el.scrollWidth > el.clientWidth + 2;
    const cutY = hides(style.overflowY) && el.scrollHeight > el.clientHeight + 2;
    if (cutX || cutY) findings.push({ kind: "clipped-text", message: `The content is ${cutX ? `${el.scrollWidth}px wide in a ${el.clientWidth}px box` : `${el.scrollHeight}px tall in a ${el.clientHeight}px box`} and the rest is hidden.`, elements: [describe(el)] });
  }

  // 4. Off screen: an interactive element beyond the window's edge (an element in a scroll container may sit out of view).
  const inScroller = (el: El): boolean => {
    for (let node = el.parentElement; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (/(auto|scroll|hidden|clip)/.test(`${s.overflowX} ${s.overflowY}`)) return true;
    }
    return false;
  };
  for (const el of doc.querySelectorAll(INTERACTIVE)) {
    if (!visible(el) || inScroller(el)) continue;
    const r = el.getBoundingClientRect();
    const docTop = r.top + win.scrollY;
    if (r.left < -1 || r.right > viewportWidth + 1 || docTop < -1) findings.push({ kind: "off-screen", message: "An interactive element lies beyond the edge of the window.", elements: [describe(el)] });
  }

  // 5. Broken image.
  for (const img of doc.querySelectorAll("img")) {
    if (img.complete && img.naturalWidth === 0 && (img.getAttribute("src") ?? "") !== "") findings.push({ kind: "broken-image", message: `The image ${img.currentSrc || img.src} did not load.`, elements: [describe(img)] });
  }
  return findings;
}

/** Serious and critical axe violations, one finding each. */
async function accessibilityFindings(page: Page): Promise<Finding[]> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      kind: "a11y" as const,
      message: `${v.id} (${v.impact}): ${v.help}`,
      elements: v.nodes.slice(0, 5).map((n) => ({ role: "", name: n.html.slice(0, 120), selector: n.target.join(" ") })),
    }));
}

/** Splits `findings` into the ones that count and the exceptions the test declared with a reason. */
export function applyAllowances(findings: Finding[], allow: Allowance[]): { findings: Finding[]; exceptions: Exception[] } {
  for (const a of allow) if (a.reason.trim() === "") throw new Error(`evidence: the exception for "${a.kind}" needs a reason.`);
  const kept: Finding[] = [];
  const exceptions: Exception[] = [];
  for (const finding of findings) {
    const allowed = allow.find((a) => a.kind === finding.kind && (a.element === undefined || finding.elements.some((e) => e.name.includes(a.element!))));
    if (allowed) exceptions.push({ ...finding, reason: allowed.reason });
    else kept.push(finding);
  }
  return { findings: kept, exceptions };
}

/**
 * Measures the page as it is now, at the window's current size: the layout, the console errors seen so far and axe.
 * `allow` turns the findings a test accepts on purpose into exceptions.
 */
export async function measurePage(page: Page, options: { name: string; consoleErrors: () => string[]; allow?: Allowance[] }): Promise<Measurements> {
  // Two frames after the resize, once the fonts are ready, so the layout is the settled one.
  await page.evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  const size = page.viewportSize() ?? { width: 0, height: 0 };
  const found: Finding[] = [
    ...(await page.evaluate(measureLayout)),
    ...options.consoleErrors().map((message) => ({ kind: "console-error" as const, message, elements: [] })),
    ...(await accessibilityFindings(page)),
  ];
  const { findings, exceptions } = applyAllowances(found, options.allow ?? []);
  return { name: options.name, width: size.width, height: size.height, findings, exceptions };
}
