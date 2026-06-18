# eve-sage M1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a runnable vertical slice — ingest the eve docs, retrieve over them with hybrid search + reranking, and answer questions with citations through an eve agent and its web widget — plus an eval harness skeleton.

**Architecture:** eve is filesystem-first: the agent lives in `agent/`. Retrieval logic lives in plain TypeScript under `lib/` (pure, unit-testable) and is exposed to the model as two `defineTool` tools. Documents are scraped, contextually chunked, embedded with Voyage (via AI Gateway), and upserted into Postgres + pgvector. Hybrid search fuses pgvector cosine similarity with Postgres full-text search via Reciprocal Rank Fusion, then a reranker orders the candidates.

**Tech Stack:** eve (beta) · TypeScript (strict) · Node 24 · `ai` SDK · Voyage embeddings + rerank via AI Gateway · Postgres + pgvector · Vitest · Next.js 16 web channel · pnpm.

## Global Constraints

- Node **24.x** (eve pins `engines.node`).
- Package manager: **pnpm**. Install deps with `pnpm add`.
- TypeScript **strict**; no `any` in committed code.
- Answer model: `anthropic/claude-opus-4.8` via AI Gateway (`AI_GATEWAY_API_KEY`) — fall back to direct `@ai-sdk/anthropic` + `ANTHROPIC_API_KEY` if no gateway.
- Embeddings: Voyage `voyage-3` (or current) via AI Gateway; vector dim recorded in schema must match the model.
- Vector store: Postgres + `pgvector`; connection via `DATABASE_URL`.
- Commits: conventional prefixes; **no `Co-Authored-By` line**; use `printf` for multi-line messages (`cat` is aliased to `bat`).
- Tools run in the **app runtime** (have `process.env`), not the sandbox.
- `defineTool` is imported from `eve/tools`; approval helpers from `eve/tools/approval`.

---

### Task 1: Scaffold eve app + dependencies + test runner

**Files:**
- Create: project files via `eve init .` (adds `agent/agent.ts`, `agent/instructions.md`, `agent/channels/eve.ts`, `package.json`, `tsconfig.json`)
- Create: `web/` (Next.js chat) via `--channel-web-nextjs`
- Modify: `package.json` (add deps + `test` script)
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: a working `pnpm dev` (eve TUI) and `pnpm test` (Vitest).

- [ ] **Step 1: Scaffold eve into the repo**

The repo already exists (README/LICENSE committed). Add eve in place:

```bash
cd ~/Developer/personal/ai-research/active/eve-sage
npx eve@latest init . --channel-web-nextjs
# eve adds eve/ai/zod deps and the agent/ + web/ scaffold without touching README/LICENSE
```

Stop the dev TUI with Ctrl+C when it opens.

- [ ] **Step 2: Add project dependencies**

```bash
pnpm add pg @ai-sdk/anthropic
pnpm add -D vitest @types/pg @types/node tsx
```

- [ ] **Step 3: Add scripts and Vitest config**

In `package.json` `scripts`, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"ingest": "tsx ingestion/index.ts",
"eval": "tsx evals/run.ts"
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "evals/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Verify scaffold runs**

Run: `pnpm test`
Expected: `No test files found` (exit 0) — Vitest is wired, no tests yet.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts agent web .gitignore
git commit -m "chore: scaffold eve app with nextjs web channel and vitest"
```

---

### Task 2: Reciprocal Rank Fusion (pure function)

**Files:**
- Create: `lib/rrf.ts`
- Test: `lib/rrf.test.ts`

**Interfaces:**
- Produces: `type Ranked = { id: string; rank: number }` and
  `fuseRRF(lists: { id: string }[][], k?: number): { id: string; score: number }[]`
  — fuses multiple ranked id-lists; higher score = better; `k` defaults to 60.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rrf.test.ts
import { describe, it, expect } from "vitest";
import { fuseRRF } from "./rrf";

describe("fuseRRF", () => {
  it("ranks an item appearing high in both lists first", () => {
    const vector = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const lexical = [{ id: "b" }, { id: "a" }, { id: "d" }];
    const out = fuseRRF([vector, lexical]);
    expect(out[0].id).toBe("a"); // top-of-both wins via summed reciprocal ranks
    expect(out.map((r) => r.id)).toContain("d");
  });

  it("is empty for empty input", () => {
    expect(fuseRRF([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/rrf.test.ts`
Expected: FAIL — `fuseRRF` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/rrf.ts
export function fuseRRF(
  lists: { id: string }[][],
  k = 60,
): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, idx) => {
      const rank = idx + 1;
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/rrf.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/rrf.ts lib/rrf.test.ts
git commit -m "feat: add reciprocal rank fusion for hybrid retrieval"
```

---

### Task 3: Contextual chunking (pure function)

**Files:**
- Create: `lib/chunking.ts`
- Test: `lib/chunking.test.ts`

**Interfaces:**
- Produces:
  `type RawDoc = { url: string; title: string; markdown: string }`
  `type Chunk = { id: string; url: string; title: string; section: string; text: string; contextualText: string }`
  `chunkDoc(doc: RawDoc, opts?: { maxChars?: number }): Chunk[]`
  — splits markdown on headings, prefixes each chunk with `"<title> › <section>\n\n"` as `contextualText` (what gets embedded). `id` is `<url>#<index>`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/chunking.test.ts
import { describe, it, expect } from "vitest";
import { chunkDoc } from "./chunking";

const doc = {
  url: "https://eve.dev/docs/tools",
  title: "Tools",
  markdown: "# Tools\nIntro line.\n## Define a tool\nA tool is a typed action.",
};

describe("chunkDoc", () => {
  it("splits on headings and carries section context", () => {
    const chunks = chunkDoc(doc);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const define = chunks.find((c) => c.section.includes("Define a tool"));
    expect(define).toBeDefined();
    expect(define!.contextualText.startsWith("Tools › Define a tool")).toBe(true);
    expect(define!.id).toBe("https://eve.dev/docs/tools#1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/chunking.test.ts`
Expected: FAIL — `chunkDoc` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/chunking.ts
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
      section = heading[1].trim();
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/chunking.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/chunking.ts lib/chunking.test.ts
git commit -m "feat: add contextual markdown chunking"
```

---

### Task 4: Postgres + pgvector schema and client

**Files:**
- Create: `db/schema.sql`
- Create: `lib/db.ts`
- Test: `lib/db.test.ts` (integration — requires `DATABASE_URL`; skipped if unset)

**Interfaces:**
- Consumes: `Chunk` from `lib/chunking.ts`.
- Produces:
  `getPool(): Pool` (singleton)
  `upsertChunks(rows: (Chunk & { embedding: number[] })[]): Promise<void>`
  `vectorSearch(embedding: number[], limit: number): Promise<{ id: string }[]>`
  `lexicalSearch(query: string, limit: number): Promise<{ id: string }[]>`
  `getChunksByIds(ids: string[]): Promise<Chunk[]>`

- [ ] **Step 1: Write the schema**

```sql
-- db/schema.sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS doc_chunks (
  id            TEXT PRIMARY KEY,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  section       TEXT NOT NULL,
  text          TEXT NOT NULL,
  embedding     VECTOR(1024) NOT NULL,            -- match Voyage model dim
  fts           TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);

CREATE INDEX IF NOT EXISTS doc_chunks_embedding_idx
  ON doc_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS doc_chunks_fts_idx
  ON doc_chunks USING gin (fts);
```

- [ ] **Step 2: Write the failing integration test**

```ts
// lib/db.test.ts
import { describe, it, expect } from "vitest";
import { upsertChunks, vectorSearch, getChunksByIds } from "./db";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("db roundtrip", () => {
  it("upserts a chunk and finds it by vector + id", async () => {
    const embedding = Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    await upsertChunks([
      { id: "t#0", url: "t", title: "T", section: "S", text: "hello eve",
        contextualText: "T › S\n\nhello eve", embedding },
    ]);
    const hit = await vectorSearch(embedding, 1);
    expect(hit[0].id).toBe("t#0");
    const rows = await getChunksByIds(["t#0"]);
    expect(rows[0].text).toBe("hello eve");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run lib/db.test.ts`
Expected: FAIL — `./db` exports missing (or SKIP if `DATABASE_URL` unset; set it to a local pgvector to run).

- [ ] **Step 4: Write the implementation**

```ts
// lib/db.ts
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

export async function vectorSearch(embedding: number[], limit: number) {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM doc_chunks ORDER BY embedding <=> $1 LIMIT $2`,
    [toVec(embedding), limit],
  );
  return rows;
}

export async function lexicalSearch(query: string, limit: number) {
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
  // preserve caller's id order
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as Chunk[];
}
```

- [ ] **Step 5: Apply schema and run test to verify it passes**

```bash
psql "$DATABASE_URL" -f db/schema.sql
pnpm vitest run lib/db.test.ts
```
Expected: PASS (with `DATABASE_URL` pointing at a pgvector-enabled DB).

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql lib/db.ts lib/db.test.ts
git commit -m "feat: add pgvector schema and db access layer"
```

---

### Task 5: Embeddings client (Voyage via AI Gateway)

**Files:**
- Create: `lib/embeddings.ts`
- Test: `lib/embeddings.test.ts` (live — skipped without credentials)

**Interfaces:**
- Produces: `embed(texts: string[]): Promise<number[][]>` — batches with the `ai` SDK `embedMany`. Output dim must equal the schema's `VECTOR(1024)`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/embeddings.test.ts
import { describe, it, expect } from "vitest";
import { embed } from "./embeddings";

const live = !!(process.env.AI_GATEWAY_API_KEY || process.env.VOYAGE_API_KEY);
(live ? describe : describe.skip)("embed", () => {
  it("returns one 1024-dim vector per input", async () => {
    const out = await embed(["hello", "world"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/embeddings.test.ts`
Expected: FAIL — `embed` not defined (or SKIP without creds).

- [ ] **Step 3: Write the implementation**

```ts
// lib/embeddings.ts
import { embedMany } from "ai";
import { gateway } from "@ai-sdk/gateway";

const MODEL = "voyage/voyage-3";

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: gateway.textEmbeddingModel(MODEL),
    values: texts,
  });
  return embeddings;
}
```

> Verify against eve.dev / AI Gateway docs: the exact Voyage gateway model id and dimension. If the chosen model is not 1024-dim, update `VECTOR(n)` in `db/schema.sql` to match before ingesting.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/embeddings.test.ts`
Expected: PASS with credentials set.

- [ ] **Step 5: Commit**

```bash
git add lib/embeddings.ts lib/embeddings.test.ts
git commit -m "feat: add voyage embeddings client via ai gateway"
```

---

### Task 6: Reranker

**Files:**
- Create: `lib/rerank.ts`
- Test: `lib/rerank.test.ts` (live — skipped without credentials)

**Interfaces:**
- Produces: `rerank(query: string, docs: { id: string; text: string }[], topN: number): Promise<{ id: string; score: number }[]>` — calls the Voyage rerank REST API; returns ids sorted by relevance.

- [ ] **Step 1: Write the failing test**

```ts
// lib/rerank.test.ts
import { describe, it, expect } from "vitest";
import { rerank } from "./rerank";

const live = !!process.env.VOYAGE_API_KEY;
(live ? describe : describe.skip)("rerank", () => {
  it("ranks the on-topic doc first", async () => {
    const out = await rerank(
      "how do I define a tool",
      [
        { id: "off", text: "Vercel deploys static sites." },
        { id: "on", text: "Use defineTool to declare a typed action." },
      ],
      2,
    );
    expect(out[0].id).toBe("on");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/rerank.test.ts`
Expected: FAIL — `rerank` not defined (or SKIP).

- [ ] **Step 3: Write the implementation**

```ts
// lib/rerank.ts
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
  return json.data.map((r) => ({ id: docs[r.index].id, score: r.relevance_score }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/rerank.test.ts`
Expected: PASS with `VOYAGE_API_KEY`.

- [ ] **Step 5: Commit**

```bash
git add lib/rerank.ts lib/rerank.test.ts
git commit -m "feat: add voyage reranker"
```

---

### Task 7: Hybrid retrieval orchestrator

**Files:**
- Create: `lib/retrieval.ts`
- Test: `lib/retrieval.test.ts` (unit — mocks db/embeddings/rerank)

**Interfaces:**
- Consumes: `embed` (Task 5), `vectorSearch`/`lexicalSearch`/`getChunksByIds` (Task 4), `fuseRRF` (Task 2), `rerank` (Task 6).
- Produces: `retrieve(query: string, opts?: { candidates?: number; topN?: number }): Promise<Chunk[]>` — embeds the query, runs vector + lexical search, fuses with RRF, reranks, returns top-N full chunks in ranked order.

- [ ] **Step 1: Write the failing test (with mocks)**

```ts
// lib/retrieval.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./embeddings", () => ({ embed: vi.fn(async () => [[0.1, 0.2]]) }));
vi.mock("./db", () => ({
  vectorSearch: vi.fn(async () => [{ id: "a" }, { id: "b" }]),
  lexicalSearch: vi.fn(async () => [{ id: "b" }, { id: "c" }]),
  getChunksByIds: vi.fn(async (ids: string[]) =>
    ids.map((id) => ({ id, url: "u", title: "T", section: "S", text: id, contextualText: id })),
  ),
}));
vi.mock("./rerank", () => ({
  rerank: vi.fn(async (_q, docs) => docs.map((d: any, i: number) => ({ id: d.id, score: 1 - i }))),
}));

import { retrieve } from "./retrieval";

describe("retrieve", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns reranked chunks fused from both searches", async () => {
    const out = await retrieve("define a tool", { topN: 2 });
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("b"); // appears in both → top after RRF + rerank
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/retrieval.test.ts`
Expected: FAIL — `retrieve` not defined.

- [ ] **Step 3: Write the implementation**

```ts
// lib/retrieval.ts
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

  const [queryEmbedding] = await embed([query]);
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
  return ranked.map((r) => byId.get(r.id)).filter(Boolean) as Chunk[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/retrieval.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/retrieval.ts lib/retrieval.test.ts
git commit -m "feat: add hybrid retrieval orchestrator (vector+lexical+rrf+rerank)"
```

---

### Task 8: Ingestion pipeline

**Files:**
- Create: `ingestion/sources.ts` (the doc URLs to ingest)
- Create: `ingestion/scrape.ts`
- Create: `ingestion/index.ts`
- Test: `ingestion/scrape.test.ts` (unit — pure parsing of a fixture)

**Interfaces:**
- Consumes: `chunkDoc` (Task 3), `embed` (Task 5), `upsertChunks` (Task 4).
- Produces: `toRawDoc(url: string, html_or_md: string): RawDoc`; an executable `ingestion/index.ts` that ingests all sources.

- [ ] **Step 1: Define sources**

```ts
// ingestion/sources.ts
export const SOURCES = [
  "https://eve.dev/docs/introduction",
  "https://eve.dev/docs/getting-started",
  "https://eve.dev/docs/agent-config",
  "https://eve.dev/docs/instructions",
  "https://eve.dev/docs/tools",
  "https://eve.dev/docs/skills",
  "https://eve.dev/docs/subagents",
  "https://eve.dev/docs/connections",
  "https://eve.dev/docs/sandbox",
  "https://eve.dev/docs/schedules",
];
```

- [ ] **Step 2: Write the failing test**

```ts
// ingestion/scrape.test.ts
import { describe, it, expect } from "vitest";
import { toRawDoc } from "./scrape";

describe("toRawDoc", () => {
  it("derives a title from the first H1", () => {
    const doc = toRawDoc("https://eve.dev/docs/tools", "# Tools\nbody text");
    expect(doc.title).toBe("Tools");
    expect(doc.url).toBe("https://eve.dev/docs/tools");
    expect(doc.markdown).toContain("body text");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run ingestion/scrape.test.ts`
Expected: FAIL — `toRawDoc` not defined.

- [ ] **Step 4: Write scrape + pipeline**

```ts
// ingestion/scrape.ts
import type { RawDoc } from "../lib/chunking";

export function toRawDoc(url: string, markdown: string): RawDoc {
  const h1 = /^#\s+(.*)$/m.exec(markdown);
  const title = h1 ? h1[1].trim() : url.split("/").pop()!;
  return { url, title, markdown };
}

// Fetch markdown for a docs URL. Uses the page's llms-style markdown if exposed,
// else falls back to raw fetch (scrape adapter can be swapped here).
export async function fetchMarkdown(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: "text/markdown,text/html" } });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return await res.text();
}
```

```ts
// ingestion/index.ts
import { SOURCES } from "./sources";
import { fetchMarkdown, toRawDoc } from "./scrape";
import { chunkDoc } from "../lib/chunking";
import { embed } from "../lib/embeddings";
import { upsertChunks } from "../lib/db";

async function main() {
  for (const url of SOURCES) {
    const raw = toRawDoc(url, await fetchMarkdown(url));
    const chunks = chunkDoc(raw);
    const vectors = await embed(chunks.map((c) => c.contextualText));
    await upsertChunks(chunks.map((c, i) => ({ ...c, embedding: vectors[i] })));
    console.log(`ingested ${chunks.length} chunks from ${url}`);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

> Scrape adapter note: if raw `fetch` returns rendered HTML rather than clean markdown for these pages, swap `fetchMarkdown` to call the Firecrawl CLI (`firecrawl scrape <url>`) and read its markdown field. Keep the `toRawDoc` interface unchanged so tests still pass.

- [ ] **Step 5: Run test, then run a live ingest**

```bash
pnpm vitest run ingestion/scrape.test.ts   # PASS
pnpm ingest                                 # requires DATABASE_URL + embedding creds
```
Expected: test PASS; ingest prints per-source chunk counts and `done`.

- [ ] **Step 6: Commit**

```bash
git add ingestion/sources.ts ingestion/scrape.ts ingestion/index.ts ingestion/scrape.test.ts
git commit -m "feat: add docs ingestion pipeline (scrape, chunk, embed, upsert)"
```

---

### Task 9: eve tools — search_docs and fetch_chunk

**Files:**
- Create: `agent/tools/search_docs.ts`
- Create: `agent/tools/fetch_chunk.ts`
- Test: `agent/tools/search_docs.test.ts` (unit — mocks `lib/retrieval`)

**Interfaces:**
- Consumes: `retrieve` (Task 7), `getChunksByIds` (Task 4).
- Produces: tool `search_docs` (input `{ query: string }`) returning `{ results: { id, url, section, text }[] }`; tool `fetch_chunk` (input `{ id: string }`) returning one chunk's full text.

- [ ] **Step 1: Write the failing test**

```ts
// agent/tools/search_docs.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("../../lib/retrieval", () => ({
  retrieve: vi.fn(async () => [
    { id: "x#0", url: "u", title: "T", section: "S", text: "answer body", contextualText: "c" },
  ]),
}));
import searchDocs from "./search_docs";

describe("search_docs tool", () => {
  it("returns trimmed results from retrieve()", async () => {
    const out = await searchDocs.execute({ query: "tools" }, {} as any);
    expect(out.results[0].id).toBe("x#0");
    expect(out.results[0].text).toBe("answer body");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run agent/tools/search_docs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the tools**

```ts
// agent/tools/search_docs.ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { retrieve } from "../../lib/retrieval";

export default defineTool({
  description:
    "Search the eve / Vercel AI stack documentation. Returns the most relevant passages with their source ids and URLs. Always cite the URLs you use.",
  inputSchema: z.object({ query: z.string().min(1) }),
  async execute({ query }) {
    const chunks = await retrieve(query, { topN: 6 });
    return {
      results: chunks.map((c) => ({
        id: c.id,
        url: c.url,
        section: c.section,
        text: c.text,
      })),
    };
  },
});
```

```ts
// agent/tools/fetch_chunk.ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getChunksByIds } from "../../lib/db";

export default defineTool({
  description:
    "Fetch the full text of a single documentation passage by its id (from search_docs results), for exact quoting and citation.",
  inputSchema: z.object({ id: z.string().min(1) }),
  async execute({ id }) {
    const [chunk] = await getChunksByIds([id]);
    if (!chunk) return { found: false as const };
    return { found: true as const, url: chunk.url, section: chunk.section, text: chunk.text };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run agent/tools/search_docs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/tools/search_docs.ts agent/tools/fetch_chunk.ts agent/tools/search_docs.test.ts
git commit -m "feat: add search_docs and fetch_chunk agent tools"
```

---

### Task 10: Root agent config + instructions

**Files:**
- Modify: `agent/agent.ts`
- Modify: `agent/instructions.md`
- Create: `agent/skills/citation-style.md`

**Interfaces:**
- Consumes: the tools from Task 9 (auto-discovered by filename).
- Produces: an agent that answers doc questions with citations.

- [ ] **Step 1: Set the model**

```ts
// agent/agent.ts
import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-opus-4.8",
});
```

- [ ] **Step 2: Write instructions**

```md
<!-- agent/instructions.md -->
You are eve-sage, an expert on eve (Vercel's agent framework), the AI SDK, and the
Workflow SDK. You answer questions using ONLY the project's documentation.

- Always call `search_docs` before answering. Use `fetch_chunk` to quote exact text.
- Ground every claim in retrieved passages. Cite the source URL inline like `[Tools](https://eve.dev/docs/tools)`.
- If the docs do not cover the question, say so plainly. Do not invent APIs.
- Prefer exact API names and short code snippets from the docs over paraphrase.
- Follow the citation format in your `citation-style` skill.
```

- [ ] **Step 3: Write the citation skill**

```md
<!-- agent/skills/citation-style.md -->
# Citation style

End every answer with a `Sources:` list of the unique URLs you used, one per line.
Inline, cite with markdown links. Never cite a URL you did not retrieve this turn.
```

- [ ] **Step 4: Manual verification**

```bash
pnpm dev        # eve TUI
# Ask: "How do I gate a tool on human approval in eve?"
```
Expected: the agent calls `search_docs`, answers using the Tools/approval docs, and lists source URLs.

- [ ] **Step 5: Commit**

```bash
git add agent/agent.ts agent/instructions.md agent/skills/citation-style.md
git commit -m "feat: configure eve-sage agent with doc-expert instructions and citations"
```

---

### Task 11: Eval harness skeleton (recall@k)

**Files:**
- Create: `evals/golden.json`
- Create: `evals/scorers.ts`
- Create: `evals/run.ts`
- Test: `evals/scorers.test.ts`

**Interfaces:**
- Consumes: `retrieve` (Task 7).
- Produces: `recallAtK(retrievedIds: string[], relevant: string[], k: number): number`; an executable `evals/run.ts` that prints recall@k over the golden set.

- [ ] **Step 1: Seed a small golden set**

```json
// evals/golden.json
[
  {
    "question": "How do I gate a tool on human approval?",
    "relevant_urls": ["https://eve.dev/docs/tools"]
  },
  {
    "question": "What is a declared subagent and where does it live?",
    "relevant_urls": ["https://eve.dev/docs/subagents"]
  },
  {
    "question": "How do I connect an agent to an MCP server?",
    "relevant_urls": ["https://eve.dev/docs/connections"]
  }
]
```

- [ ] **Step 2: Write the failing test**

```ts
// evals/scorers.test.ts
import { describe, it, expect } from "vitest";
import { recallAtK } from "./scorers";

describe("recallAtK", () => {
  it("is 1 when a relevant url is in the top-k", () => {
    const retrieved = ["https://eve.dev/docs/tools#2", "https://eve.dev/docs/skills#0"];
    expect(recallAtK(retrieved, ["https://eve.dev/docs/tools"], 5)).toBe(1);
  });
  it("is 0 when no relevant url appears", () => {
    expect(recallAtK(["https://eve.dev/docs/skills#0"], ["https://eve.dev/docs/tools"], 5)).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run evals/scorers.test.ts`
Expected: FAIL — `recallAtK` not defined.

- [ ] **Step 4: Write scorer + runner**

```ts
// evals/scorers.ts
// Recall@k by source URL: a retrieved chunk id "<url>#<i>" matches a relevant url by prefix.
export function recallAtK(retrievedIds: string[], relevant: string[], k: number): number {
  const top = retrievedIds.slice(0, k);
  const hit = relevant.some((url) => top.some((id) => id.startsWith(url)));
  return hit ? 1 : 0;
}
```

```ts
// evals/run.ts
import golden from "./golden.json";
import { retrieve } from "../lib/retrieval";
import { recallAtK } from "./scorers";

async function main() {
  const K = 5;
  let sum = 0;
  for (const c of golden as { question: string; relevant_urls: string[] }[]) {
    const chunks = await retrieve(c.question, { topN: K });
    const score = recallAtK(chunks.map((x) => x.id), c.relevant_urls, K);
    sum += score;
    console.log(`recall@${K}=${score}  ${c.question}`);
  }
  console.log(`mean recall@${K} = ${(sum / golden.length).toFixed(3)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run test, then run the eval**

```bash
pnpm vitest run evals/scorers.test.ts   # PASS
pnpm eval                                # requires ingested DB + creds
```
Expected: test PASS; eval prints per-question recall@5 and a mean.

- [ ] **Step 6: Commit**

```bash
git add evals/golden.json evals/scorers.ts evals/run.ts evals/scorers.test.ts
git commit -m "feat: add eval harness skeleton with recall@k scorer"
```

---

### Task 12: Environment template + README quickstart update

**Files:**
- Create: `.env.example`
- Modify: `README.md` (replace the "coming with M1" quickstart with real steps)

**Interfaces:**
- Produces: a documented local-run path.

- [ ] **Step 1: Write `.env.example`**

```bash
# .env.example
# One of these for the answer model:
AI_GATEWAY_API_KEY=
# or, for direct Anthropic:
ANTHROPIC_API_KEY=

# Embeddings + rerank (Voyage):
VOYAGE_API_KEY=

# Postgres + pgvector:
DATABASE_URL=postgres://user:pass@host:5432/eve_sage
```

- [ ] **Step 2: Update README quickstart**

Replace the Getting Started code block in `README.md` with:

```bash
pnpm install
cp .env.example .env.local        # fill in keys + DATABASE_URL
psql "$DATABASE_URL" -f db/schema.sql
pnpm ingest                        # scrape + embed the docs corpus
pnpm dev                           # eve TUI + web widget
pnpm test                          # unit tests
pnpm eval                          # retrieval recall@k over the golden set
```

Then check the **M1** roadmap box: `- [x] **M1 — Core**: ...`.

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: add env template and real M1 quickstart"
```

---

## Self-Review

**Spec coverage (M1 portion):**
- Ingestion (contextual chunking) → Tasks 3, 8 ✓
- Hybrid search (pgvector + FTS + RRF) → Tasks 2, 4, 7 ✓
- Reranking → Tasks 6, 7 ✓
- search_docs / fetch_chunk tools → Task 9 ✓
- Root agent + citations → Task 10 ✓
- Eval harness skeleton + golden set → Task 11 ✓
- Web widget → Task 1 (`--channel-web-nextjs`), verified in Task 10 ✓
- Out of M1 (deferred to M2–M4): subagents, verifier, multi-hop, full eval metrics (faithfulness/correctness/citation), Slack/GitHub channels, approval gate, tracing, CI gate, deploy. Tracked in spec roadmap. ✓

**Placeholder scan:** No "TBD/TODO" in steps. Two `>` notes flag *verification points* against external API shapes (Voyage gateway model id/dim; scrape adapter), each with a concrete fallback — not deferred work.

**Type consistency:** `Chunk`/`RawDoc` defined in Task 3 and consumed unchanged in Tasks 4, 7, 8, 9. `retrieve` signature (Task 7) matches its callers (Tasks 9, 11). `getChunksByIds` returns `Chunk[]` with `contextualText` synthesized in SQL, matching the type. Vector dim `1024` is consistent between `db/schema.sql` (Task 4) and the embeddings test (Task 5), with an explicit note to update both together if the model dim differs.

## Notes for the implementer

- Local Postgres with pgvector: `docker run -e POSTGRES_PASSWORD=pass -p 5432:5432 pgvector/pgvector:pg16`, then `DATABASE_URL=postgres://postgres:pass@localhost:5432/postgres`.
- Run live-credential tests only after filling `.env.local`; without creds those suites self-skip (by design).
- Keep commits per-task; each task is independently reviewable.
