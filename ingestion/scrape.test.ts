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
