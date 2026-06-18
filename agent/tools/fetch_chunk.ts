import { defineTool } from "eve/tools";
import { z } from "zod";
import { getChunksByIds } from "../../lib/db";

export default defineTool({
  description:
    "Fetch the full text of a single documentation passage by its id (from search_docs results), for exact quoting and citation.",
  inputSchema: z.object({ id: z.string().min(1) }),
  async execute({ id }) {
    const [chunk] = await getChunksByIds([id]);
    if (!chunk) return { found: false as const };
    return { found: true as const, url: chunk.url, section: chunk.section, text: chunk.text };
  },
});
