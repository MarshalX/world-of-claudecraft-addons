// Run a list of async steps one after another.
//
// Three places need this and all three are sequential on purpose, not by
// accident: refreshing several marketplace indexes queues rather than bursting
// at a rate-limited GitHub, polling addon bodies keeps one dev-server request in
// flight at a time, and starting addons in registry order means the first one to
// claim a keybind is the first one listed rather than the first one to resolve.
//
// Written as a chain rather than as `for (...) await`, which is the same thing
// with a lint rule against it: the rule exists to catch accidental serialization
// of work that could be parallel, and saying it deliberately is clearer than
// exempting each loop.

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
