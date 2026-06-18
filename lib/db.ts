import { Pool } from "pg";
import type { Chunk } from "./chunking";

let pool: Pool | undefined;
export function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const toVec = (e: number[]) => `[${e.join(",")}]`;

export async function upsertChunks(
  rows: (Chunk & { embedding: number[] })[],
): Promise<void> {
  const p = getPool();
  for (const r of rows) {
    await p.query(
      `INSERT INTO doc_chunks (id, url, title, section, text, embedding)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         url=$2, title=$3, section=$4, text=$5, embedding=$6`,
      [r.id, r.url, r.title, r.section, r.text, toVec(r.embedding)],
    );
  }
}

export async function vectorSearch(embedding: number[], limit: number): Promise<{ id: string }[]> {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM doc_chunks ORDER BY embedding <=> $1 LIMIT $2`,
    [toVec(embedding), limit],
  );
  return rows;
}

export async function lexicalSearch(query: string, limit: number): Promise<{ id: string }[]> {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM doc_chunks
     WHERE fts @@ plainto_tsquery('english', $1)
     ORDER BY ts_rank(fts, plainto_tsquery('english', $1)) DESC
     LIMIT $2`,
    [query, limit],
  );
  return rows;
}

export async function getChunksByIds(ids: string[]): Promise<Chunk[]> {
  if (ids.length === 0) return [];
  const { rows } = await getPool().query<Chunk>(
    `SELECT id, url, title, section, text,
            (title || ' › ' || section || E'\n\n' || text) AS "contextualText"
     FROM doc_chunks WHERE id = ANY($1)`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((c): c is Chunk => Boolean(c));
}
