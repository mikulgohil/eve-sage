import { describe, it, expect } from "vitest";
import { embed } from "./embeddings";

const live = !!process.env.VOYAGE_API_KEY;
(live ? describe : describe.skip)("embed", () => {
  it("returns one 1024-dim vector per input", async () => {
    const out = await embed(["hello", "world"], "document");
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(1024);
  });
});
