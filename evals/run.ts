import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { retrieve } from "../lib/retrieval";
import { recallAtK } from "./scorers";

type Case = { question: string; relevant_urls: string[] };

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "golden.json"), "utf8")) as Case[];

async function main() {
  const K = 5;
  let sum = 0;
  for (const c of golden) {
    const chunks = await retrieve(c.question, { topN: K });
    const score = recallAtK(chunks.map((x) => x.id), c.relevant_urls, K);
    sum += score;
    console.log(`recall@${K}=${score}  ${c.question}`);
  }
  console.log(`mean recall@${K} = ${(sum / golden.length).toFixed(3)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
