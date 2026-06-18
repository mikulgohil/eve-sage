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
