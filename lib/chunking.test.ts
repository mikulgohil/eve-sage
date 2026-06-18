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
