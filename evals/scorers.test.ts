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
