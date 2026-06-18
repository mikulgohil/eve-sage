import { describe, it, expect } from "vitest";
import { upsertChunks, vectorSearch, getChunksByIds } from "./db";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("db roundtrip", () => {
  it("upserts a chunk and finds it by vector + id", async () => {
    const embedding = Array(1024)
      .fill(0)
      .map((_, i) => (i === 0 ? 1 : 0));
    await upsertChunks([
      {
        id: "t#0",
        url: "t",
        title: "T",
        section: "S",
        text: "hello eve",
        contextualText: "T › S\n\nhello eve",
        embedding,
      },
    ]);
    const hit = await vectorSearch(embedding, 1);
    expect(hit[0]!.id).toBe("t#0");
    const rows = await getChunksByIds(["t#0"]);
    expect(rows[0]!.text).toBe("hello eve");
  });
});
