/**
 * The `## Acceptance criteria` section of an issue body: where `- [ ]` items are counted and checked. The section ends
 * at the next heading; nothing outside it is read or touched.
 */
const SECTION_HEADING = /^##\s+Acceptance criteria\s*$/i;
const ANY_HEADING = /^#{1,6}\s/;
const ITEM = /^\s*[-*+] \[[ xX]\]/;
const UNCHECKED = /^(\s*[-*+] \[) (\])/;

/** The lines of `body` (each with its own terminator, so joining them gives `body` back) and the section's `[start, end)`. */
function section(body: string): { lines: string[]; start: number; end: number } | null {
  const lines = body.split(/(?<=\n)/);
  const heading = lines.findIndex((line) => SECTION_HEADING.test(line.trimEnd()));
  if (heading < 0) return null;
  const next = lines.findIndex((line, i) => i > heading && ANY_HEADING.test(line));
  return { lines, start: heading + 1, end: next < 0 ? lines.length : next };
}

/** How many checkbox items the criteria section has, checked or not. */
export function countCriteria(body: string): number {
  const s = section(body);
  return s ? s.lines.slice(s.start, s.end).filter((line) => ITEM.test(line)).length : 0;
}

/** `body` with every `- [ ]` of the criteria section checked, and every other byte unchanged. */
export function checkCriteria(body: string): string {
  const s = section(body);
  if (!s) return body;
  return s.lines.map((line, i) => (i >= s.start && i < s.end ? line.replace(UNCHECKED, "$1x$2") : line)).join("");
}
