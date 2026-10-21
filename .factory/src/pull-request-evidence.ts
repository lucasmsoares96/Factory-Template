import type { EvidenceImage } from "./seams/code-host.ts";

const IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

/**
 * Makes the Pull Request Stage text and the evidence agree. A reference to a print is pointed at the image's own
 * `path` (the Stage sees `test-results/evidence/<product>/<name>`), a reference to anything else local is removed
 * (remote images stay), and a print the text never references is appended at the end of the Evidence section,
 * grouped by Product.
 */
export function withEvidence(text: string, images: EvidenceImage[]): string {
  if (images.length === 0) return removeUnknownReferences(text, images);
  const used = new Set<EvidenceImage>();
  const resolved = rewriteReferences(text, images, used);
  const missing = images.filter((i) => !used.has(i));
  return missing.length === 0 ? resolved : appendToEvidence(resolved, missing);
}

function removeUnknownReferences(text: string, images: EvidenceImage[]): string {
  return rewriteReferences(text, images, new Set());
}

function rewriteReferences(text: string, images: EvidenceImage[], used: Set<EvidenceImage>): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    let removed = false;
    const next = line.replace(IMAGE, (whole, alt: string, target: string) => {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return whole;
      const image = find(images, target);
      if (!image) {
        removed = true;
        return "";
      }
      used.add(image);
      return `![${alt}](${image.path})`;
    });
    // A line that held only a removed reference goes away with it.
    if (removed && next.trim() === "") continue;
    out.push(next);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function find(images: EvidenceImage[], target: string): EvidenceImage | undefined {
  const clean = target.replace(/^\.\//, "");
  return images.find((i) => clean === i.path || clean === `${i.product}/${i.name}` || clean.endsWith(`/${i.product}/${i.name}`));
}

function groups(images: EvidenceImage[]): string[] {
  const byProduct = new Map<string, EvidenceImage[]>();
  for (const image of images) byProduct.set(image.product, [...(byProduct.get(image.product) ?? []), image]);
  return [...byProduct].flatMap(([product, list]) => ["", `### ${product}`, "", ...list.map((i) => `![${i.name}](${i.path})`)]);
}

function appendToEvidence(text: string, missing: EvidenceImage[]): string {
  const lines = text.split("\n");
  let fenced = false;
  let start = -1;
  let level = 0;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) fenced = !fenced;
    if (fenced) continue;
    const heading = HEADING.exec(lines[i]!);
    if (!heading) continue;
    if (start === -1) {
      if (/^evidence$/i.test(heading[2]!)) [start, level] = [i, heading[1]!.length];
    } else if (heading[1]!.length <= level) {
      end = i;
      break;
    }
  }
  if (start === -1) return [text.trimEnd(), "", "## Evidence", ...groups(missing)].join("\n");
  while (end > start + 1 && lines[end - 1]!.trim() === "") end--;
  const sub = "#".repeat(Math.min(level + 1, 6));
  const added = groups(missing).map((l) => (l.startsWith("### ") ? `${sub} ${l.slice(4)}` : l));
  const after = lines.slice(end);
  return [...lines.slice(0, end), ...added, ...(after.length && after[0]!.trim() !== "" ? [""] : []), ...after].join("\n");
}
