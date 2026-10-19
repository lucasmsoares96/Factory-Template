/** The first link in an email's HTML whose URL contains `path`. */
export function linkIn(html: string, path: string): string {
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    const url = href!.replaceAll("&amp;", "&");
    if (url.includes(path)) return url;
  }
  throw new Error(`No link to ${path} in the email.`);
}
