// The woc.data surface: a JSON file from the addon's own directory.
//
// The file is fetched by the HOST, at install, into the same cache the entry body
// lives in. What is left for the page realm is a membership check against the
// manifest, one parse, and a memo. Nothing here touches the network, which is the
// whole reason the gap was answered this way rather than by handing an addon a
// base URL: a base URL is a second network path in the page realm, with no cache
// and no bound on where it points.
//
// The argument is CHECKED, not joined. `woc.data('../../secrets.json')` is
// refused because it is not in the declared list, and no code path anywhere
// concatenates the argument onto a URL.

// Type-only. A value import of anything in shared/schema.ts drags zod into the
// page bundle, which loader/build-runtime.mjs fails the build over.
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

/**
 * Why a name was refused, naming what IS declared.
 *
 * The list goes in the message because the failure is almost always a typo or a
 * file added to the directory and not to the manifest, and both of those read as
 * "it works on my machine" without it.
 */
function undeclared(fqid: string, declared: readonly string[], name: string): Error {
  return new Error(
    `${fqid}: woc.data(${JSON.stringify(name)}) is not declared. Add it to "data" in ` +
      `addon.json. Declared: ${declaredList(declared)}`,
  );
}

/**
 * One addon's reader.
 *
 * The memo holds the PROMISE, so two calls in one addon share one bridge round
 * trip and one parse. A rejection is dropped from the memo rather than kept: the
 * reasons this rejects that are worth retrying (a bridge that never connected)
 * are not the addon's doing, and a memoised rejection would outlive the
 * condition. A resolved value is shared, so the object handed back is the same
 * object every time and an addon must treat it as read-only.
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

  // Async, so every refusal is a rejection. A surface that threw synchronously
  // here and rejected over the bridge would be two different APIs depending on
  // where it was called from.
  return async (name) => {
    if (!declared.includes(name)) {
      throw undeclared(deps.fqid, declared, name);
    }
    return await memoised(name);
  };
}

export type { DataDeps };
export { createData };
