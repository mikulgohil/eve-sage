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
    expect(out[0]!.id).toBe("on");
  });
});
