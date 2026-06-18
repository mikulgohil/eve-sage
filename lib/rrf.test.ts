import { describe, it, expect } from "vitest";
import { fuseRRF } from "./rrf";

describe("fuseRRF", () => {
  it("ranks an item appearing high in both lists first", () => {
    const vector = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const lexical = [{ id: "b" }, { id: "a" }, { id: "d" }];
    const out = fuseRRF([vector, lexical]);
    expect(out[0]!.id).toBe("a"); // top-of-both wins via summed reciprocal ranks
    expect(out.map((r) => r.id)).toContain("d");
  });

  it("is empty for empty input", () => {
    expect(fuseRRF([])).toEqual([]);
  });
});
