/**
 * The Factory writes with its owner's token, so the author does not tell its words from a person's. Every text it
 * writes carries this hidden marker; the write adapters put it there (`marked`), and the readers look for it
 * (`isMarked`). A person who types it is ignored, a trade accepted in ADR 0002.
 */
export const FACTORY_MARKER = "<!-- factory -->";

/** `text` with the marker appended, once. */
export function marked(text: string): string {
  return isMarked(text) ? text : `${text.trimEnd()}\n\n${FACTORY_MARKER}`;
}

export function isMarked(text: string): boolean {
  return text.includes(FACTORY_MARKER);
}
