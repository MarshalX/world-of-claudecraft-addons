// The woc.data surface. The HOST fetches the file at install; here is only a membership check, a
// parse and a memo, with no network path. The argument is CHECKED against the declared list and
// never joined onto a URL.

// Type-only: a value import from shared/schema.ts drags zod into the page bundle.
import type { AddonManifest } from '../../shared/schema.ts';

interface DataDeps {
  fqid: string;
  /** The manifest's declared list. A name that is not on it is refused. */
  declared: AddonManifest['data'];
  /** The host's cached copy. Rejects when the bridge never connected. */
  read: (fqid: string, name: string) => Promise<string>;
}

/** What this addon declared, or the word for having declared none. */
function declaredList(declared: readonly string[]): string {
  if (declared.length === 0) {
    return 'nothing';
  }
  return declared.join(', ');
}

/** Names what IS declared: the cause is usually a typo or a file missing from the manifest. */
function undeclared(fqid: string, declared: readonly string[], name: string): Error {
  return new Error(
    `${fqid}: woc.data(${JSON.stringify(name)}) is not declared. Add it to "data" in ` +
      `addon.json. Declared: ${declaredList(declared)}`,
  );
}

/**
 * The memo holds the promise, so concurrent calls share one round trip; a rejection is dropped so
 * it can be retried. The resolved object is shared and must be treated as read-only.
 */
function createData(deps: DataDeps): (name: string) => Promise<unknown> {
  const declared = deps.declared ?? [];
  const pending = new Map<string, Promise<unknown>>();

  const load = async (name: string): Promise<unknown> => {
    const text = await deps.read(deps.fqid, name);
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`${deps.fqid}: ${name} is not valid JSON: ${String(err)}`, { cause: err });
    }
  };

  const memoised = (name: string): Promise<unknown> => {
    const already = pending.get(name);
    if (already !== undefined) {
      return already;
    }
    const run = load(name).catch((err: unknown) => {
      pending.delete(name);
      throw err;
    });
    pending.set(name, run);
    return run;
  };

  // Async, so every refusal is a rejection, as it would be over the bridge.
  return async (name) => {
    if (!declared.includes(name)) {
      throw undeclared(deps.fqid, declared, name);
    }
    return await memoised(name);
  };
}

export type { DataDeps };
export { createData };
