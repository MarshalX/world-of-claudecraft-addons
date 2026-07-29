// A namespaced key-value store shaped like the host's, for suites about the
// things built on top of it.
//
// Real multi-key storage rather than one cell. The registry now writes an
// installed list AND one cached source body per addon, so a single-cell fake
// would let a bug that wrote the source over the list pass unnoticed.

import type { StorageApi } from '../../loader/src/shared/protocol.ts';

interface FakeHostStorage extends StorageApi {
  /** Everything written, keyed `ns:key`, for a test to assert on directly. */
  readonly cells: Map<string, unknown>;
  /** The ns and key of every read and write, in order. */
  readonly touched: readonly [string, string][];
}

function cellKey(ns: string, key: string): string {
  return `${ns}:${key}`;
}

function createFakeHostStorage(seed: Record<string, unknown> = {}): FakeHostStorage {
  const cells = new Map(Object.entries(seed));
  const touched: [string, string][] = [];

  return {
    cells,
    touched,

    get: (ns, key) => {
      touched.push([ns, key]);
      return Promise.resolve(cells.get(cellKey(ns, key)));
    },

    set: (ns, key, value) => {
      touched.push([ns, key]);
      cells.set(cellKey(ns, key), value);
      return Promise.resolve();
    },

    delete: (ns, key) => {
      touched.push([ns, key]);
      cells.delete(cellKey(ns, key));
      return Promise.resolve();
    },

    keys: (ns) => {
      const prefix = `${ns}:`;
      return Promise.resolve(
        [...cells.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length)),
      );
    },
  };
}

export type { FakeHostStorage };
export { cellKey, createFakeHostStorage };
