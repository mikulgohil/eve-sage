// Recall@k by source URL: a retrieved chunk id "<url>#<i>" matches a relevant
// url by prefix. Returns 1 if any relevant url appears in the top-k, else 0.
export function recallAtK(retrievedIds: string[], relevant: string[], k: number): number {
  const top = retrievedIds.slice(0, k);
  const hit = relevant.some((url) => top.some((id) => id.startsWith(url)));
  return hit ? 1 : 0;
}
