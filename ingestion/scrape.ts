import type { RawDoc } from "../lib/chunking";

export function toRawDoc(url: string, markdown: string): RawDoc {
  const h1 = /^#\s+(.*)$/m.exec(markdown);
  const title = h1 ? h1[1]!.trim() : url.split("/").pop()!;
  return { url, title, markdown };
}

// Fetch markdown for a docs URL. If raw fetch returns rendered HTML rather than
// clean markdown for these pages, swap this to call the Firecrawl CLI
// (`firecrawl scrape <url>`) and read its markdown field — keep this signature
// unchanged so toRawDoc and its test stay valid.
export async function fetchMarkdown(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: "text/markdown,text/html" } });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return await res.text();
}
