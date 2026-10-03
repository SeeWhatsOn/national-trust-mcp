const NEXT_DATA_RE = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/;

/** Pull the Next.js page payload out of a page's HTML. */
export function extractNextData(html: string): any {
  const m = html.match(NEXT_DATA_RE);
  if (!m?.[1]) throw new Error("Page has no __NEXT_DATA__ script; the site layout may have changed.");
  return JSON.parse(m[1]);
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘",
  ndash: "–", mdash: "—", pound: "£",
};

/** Strip HTML tags and decode common entities into compact plain text. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (all, e: string) =>
      ENTITIES[e.toLowerCase()] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : all),
    )
    .replace(/[ \t\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
