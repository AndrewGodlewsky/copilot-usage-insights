// Bound filesystem work while applying results in discovery order, including copied logs.
export async function inOrder(items, task, parallel = 16) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await task(items[i]); }
  }));
  return results;
}
