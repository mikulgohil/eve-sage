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
  // emulate Voyage rerank: honor top_k (topN) server-side
  rerank: vi.fn(async (_q: string, docs: { id: string }[], topN: number) =>
    docs.slice(0, topN).map((d, i) => ({ id: d.id, score: 1 - i })),
  ),
}));

import { retrieve } from "./retrieval";

describe("retrieve", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns reranked chunks fused from both searches", async () => {
    const out = await retrieve("define a tool", { topN: 2 });
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("b"); // appears in both → top after RRF + rerank
  });
});
