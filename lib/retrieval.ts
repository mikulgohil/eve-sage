import type { Chunk } from "./chunking";
import { embed } from "./embeddings";
import { vectorSearch, lexicalSearch, getChunksByIds } from "./db";
import { fuseRRF } from "./rrf";
import { rerank } from "./rerank";

export async function retrieve(
  query: string,
  opts: { candidates?: number; topN?: number } = {},
): Promise<Chunk[]> {
  const candidates = opts.candidates ?? 20;
  const topN = opts.topN ?? 6;

  const [queryEmbedding] = await embed([query], "query");
  if (!queryEmbedding) return [];

  const [vec, lex] = await Promise.all([
    vectorSearch(queryEmbedding, candidates),
    lexicalSearch(query, candidates),
  ]);

  const fused = fuseRRF([vec, lex]).slice(0, candidates);
  const chunks = await getChunksByIds(fused.map((f) => f.id));
  if (chunks.length === 0) return [];

  const ranked = await rerank(
    query,
    chunks.map((c) => ({ id: c.id, text: c.contextualText })),
    topN,
  );
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return ranked.map((r) => byId.get(r.id)).filter((c): c is Chunk => Boolean(c));
}
