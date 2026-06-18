import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/retrieval", () => ({
  retrieve: vi.fn(async () => [
    { id: "x#0", url: "u", title: "T", section: "S", text: "answer body", contextualText: "c" },
  ]),
}));

import searchDocs from "../agent/tools/search_docs";

describe("search_docs tool", () => {
  it("returns trimmed results from retrieve()", async () => {
    const out = await searchDocs.execute({ query: "tools" }, {} as never);
    expect(out.results[0]!.id).toBe("x#0");
    expect(out.results[0]!.text).toBe("answer body");
  });
});
