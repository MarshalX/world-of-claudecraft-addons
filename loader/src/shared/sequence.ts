// Run async steps one after another, for callers that must not run in parallel (a rate-limited
// GitHub, one dev-server request at a time, keybinds claimed in registry order). A chain rather
// than `for (...) await`, which the linter flags as accidental serialization.

/** Await each item's task in order. Rejects with the first failure. */
export async function inSeries<T>(
  items: Iterable<T>,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let chain = Promise.resolve();
  for (const item of items) {
    chain = chain.then(() => run(item));
  }
  await chain;
}
