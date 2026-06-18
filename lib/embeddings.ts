// Voyage embeddings via the REST API. voyage-3 returns 1024-dim vectors,
// which must match the VECTOR(1024) column in db/schema.sql.
const MODEL = "voyage-3";

export type InputType = "query" | "document";

export async function embed(
  texts: string[],
  inputType: InputType = "document",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: texts, model: MODEL, input_type: inputType }),
  });
  if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };
  return json.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
