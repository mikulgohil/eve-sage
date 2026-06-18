CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS doc_chunks (
  id            TEXT PRIMARY KEY,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  section       TEXT NOT NULL,
  text          TEXT NOT NULL,
  embedding     VECTOR(1024) NOT NULL,            -- must match the Voyage embedding model dim
  fts           TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);

CREATE INDEX IF NOT EXISTS doc_chunks_embedding_idx
  ON doc_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS doc_chunks_fts_idx
  ON doc_chunks USING gin (fts);
