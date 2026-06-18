type RerankDoc = { id: string; text: string };

export async function rerank(
  query: string,
  docs: RerankDoc[],
  topN: number,
): Promise<{ id: string; score: number }[]> {
  if (docs.length === 0) return [];
  const res = await fetch("https://api.voyageai.com/v1/rerank", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      documents: docs.map((d) => d.text),
      model: "rerank-2",
      top_k: topN,
    }),
  });
  if (!res.ok) throw new Error(`rerank failed: ${res.status}`);
  const json = (await res.json()) as {
    data: { index: number; relevance_score: number }[];
  };
  return json.data.map((r) => ({ id: docs[r.index]!.id, score: r.relevance_score }));
}
