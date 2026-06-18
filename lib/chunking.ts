export type RawDoc = { url: string; title: string; markdown: string };
export type Chunk = {
  id: string;
  url: string;
  title: string;
  section: string;
  text: string;
  contextualText: string;
};

export function chunkDoc(doc: RawDoc, opts: { maxChars?: number } = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 1200;
  const lines = doc.markdown.split("\n");
  const blocks: { section: string; text: string }[] = [];
  let section = doc.title;
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) blocks.push({ section, text });
    buf = [];
  };

  for (const line of lines) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      section = heading[1]!.trim();
    } else {
      buf.push(line);
    }
  }
  flush();

  const chunks: Chunk[] = [];
  let i = 0;
  for (const b of blocks) {
    for (let start = 0; start < b.text.length; start += maxChars) {
      const text = b.text.slice(start, start + maxChars);
      chunks.push({
        id: `${doc.url}#${i}`,
        url: doc.url,
        title: doc.title,
        section: b.section,
        text,
        contextualText: `${doc.title} › ${b.section}\n\n${text}`,
      });
      i++;
    }
  }
  return chunks;
}
