/**
 * Decodes the form encoding Stripe's API uses (`metadata[userId]=u1`,
 * `line_items[0][price]=p`, `lookup_keys[0]=k`) into nested objects and arrays.
 * Values stay strings, as Stripe's do before it casts them.
 */
export function parseForm(source: string | URLSearchParams): Record<string, unknown> {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  const root: Record<string, unknown> = {};
  for (const [key, value] of params) {
    const path = key.replaceAll("]", "").split("[");
    // A key that would reach the prototype is dropped, never decoded.
    if (path.some((part) => part === "__proto__" || part === "constructor" || part === "prototype")) continue;
    let node = root as Record<string, unknown>;
    path.forEach((part, index) => {
      if (index === path.length - 1) {
        node[part] = value;
        return;
      }
      const next = path[index + 1] ?? "";
      const child = node[part];
      node[part] = typeof child === "object" && child !== null ? child : /^\d+$/.test(next) ? [] : {};
      node = node[part] as Record<string, unknown>;
    });
  }
  return root;
}
