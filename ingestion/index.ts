import { SOURCES } from "./sources";
import { fetchMarkdown, toRawDoc } from "./scrape";
import { chunkDoc } from "../lib/chunking";
import { embed } from "../lib/embeddings";
import { upsertChunks } from "../lib/db";

async function main() {
  for (const url of SOURCES) {
    const raw = toRawDoc(url, await fetchMarkdown(url));
    const chunks = chunkDoc(raw);
    const vectors = await embed(
      chunks.map((c) => c.contextualText),
      "document",
    );
    await upsertChunks(chunks.map((c, i) => ({ ...c, embedding: vectors[i]! })));
    console.log(`ingested ${chunks.length} chunks from ${url}`);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
