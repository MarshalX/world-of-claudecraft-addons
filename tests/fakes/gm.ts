// Stand-ins for the userscript managers the GM adapter has to cope with.

import type { GmSource } from '../../loader/src/host/gm.ts';

type NativeListener = (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => void;

/** The stored value, else the caller's fallback. */
function read(store: Map<string, unknown>, key: string, fallback: unknown): unknown {
  if (store.has(key)) {
    return store.get(key);
  }
  return fallback;
}

/** A callback that must never fire, without an empty block. */
export const noop = (): undefined => undefined;

/** Tampermonkey and Violentmonkey: both GM.* and the legacy GM_* names. */
export function fullSource(): GmSource {
  const store = new Map<string, unknown>();
  const listeners = new Map<number, { key: string; cb: NativeListener }>();
  let nextId = 1;
  return {
    gm: {
      getValue: (k, f) => Promise.resolve(read(store, k, f)),
      setValue: (k, v) => {
        store.set(k, v);
        return Promise.resolve();
      },
      deleteValue: (k) => {
        store.delete(k);
        return Promise.resolve();
      },
      listValues: () => Promise.resolve([...store.keys()]),
      addValueChangeListener: (key, cb) => {
        const id = nextId;
        nextId += 1;
        listeners.set(id, { key, cb });
        return id;
      },
      removeValueChangeListener: (id) => {
        listeners.delete(id as number);
      },
      registerMenuCommand: noop,
    },
    legacyGetValue: (k, f) => read(store, k, f),
    legacySetValue: (k, v) => {
      store.set(k, v);
    },
    legacyRegisterMenuCommand: noop,
  };
}

/**
 * Violentmonkey 2.45, as observed rather than assumed.
 *
 * Its GM object stops at registerMenuCommand, so the promise-based store pairs
 * with the legacy value-change listener. That mix is the shape the loader
 * actually runs on, and neither fullSource nor legacyOnlySource covers it.
 */
export interface TampermonkeySource extends GmSource {
  /** A write from another tab. Own writes echo by themselves, as the real one does. */
  emit: (key: string, value: unknown) => void;
}

/**
 * Tampermonkey 5.5, as observed rather than assumed.
 *
 * Two things differ from Violentmonkey and both are load-bearing: the listener
 * lives on the GM object, and its id arrives as a promise. It also echoes the
 * calling tab's own writes back with remote false, which Violentmonkey does not,
 * so setValue below fires listeners the same way.
 */
export function tampermonkeySource(): TampermonkeySource {
  const store = new Map<string, unknown>();
  const listeners = new Map<number, { key: string; cb: NativeListener }>();
  let nextId = 1;

  const fire = (key: string, value: unknown, remote: boolean): void => {
    for (const { key: watched, cb } of listeners.values()) {
      if (watched === key) {
        cb(key, undefined, value, remote);
      }
    }
  };

  return {
    gm: {
      getValue: (k, f) => Promise.resolve(read(store, k, f)),
      setValue: (k, v) => {
        store.set(k, v);
        fire(k, v, false);
        return Promise.resolve();
      },
      deleteValue: (k) => {
        store.delete(k);
        fire(k, undefined, false);
        return Promise.resolve();
      },
      listValues: () => Promise.resolve([...store.keys()]),
      addValueChangeListener: (key, cb) => {
        const id = nextId;
        nextId += 1;
        listeners.set(id, { key, cb });
        return Promise.resolve(id);
      },
      removeValueChangeListener: (id) => {
        listeners.delete(id as number);
        return Promise.resolve();
      },
      registerMenuCommand: noop,
    },
    legacyGetValue: (k, f) => read(store, k, f),
    legacySetValue: (k, v) => {
      store.set(k, v);
    },
    legacyDeleteValue: (k) => {
      store.delete(k);
    },
    legacyListValues: () => [...store.keys()],
    legacyAddValueChangeListener: (key, cb) => {
      const id = nextId;
      nextId += 1;
      listeners.set(id, { key, cb });
      return id;
    },
    legacyRemoveValueChangeListener: (id) => {
      listeners.delete(id as number);
    },
    legacyRegisterMenuCommand: noop,
    broadcastChannel: FakeChannel as unknown as typeof BroadcastChannel,
    emit: (key, value) => fire(key, value, true),
  };
}

export interface ViolentmonkeySource extends GmSource {
  /** Fires the way GM_addValueChangeListener does for a write in another tab. */
  emit: (key: string, value: unknown) => void;
}

export function violentmonkeySource(): ViolentmonkeySource {
  const store = new Map<string, unknown>();
  const listeners = new Map<number, { key: string; cb: NativeListener }>();
  let nextId = 1;
  return {
    gm: {
      getValue: (k, f) => Promise.resolve(read(store, k, f)),
      setValue: (k, v) => {
        store.set(k, v);
        return Promise.resolve();
      },
      deleteValue: (k) => {
        store.delete(k);
        return Promise.resolve();
      },
      listValues: () => Promise.resolve([...store.keys()]),
      registerMenuCommand: noop,
    },
    legacyGetValue: (k, f) => read(store, k, f),
    legacySetValue: (k, v) => {
      store.set(k, v);
    },
    legacyDeleteValue: (k) => {
      store.delete(k);
    },
    legacyListValues: () => [...store.keys()],
    legacyAddValueChangeListener: (key, cb) => {
      const id = nextId;
      nextId += 1;
      listeners.set(id, { key, cb });
      return id;
    },
    legacyRemoveValueChangeListener: (id) => {
      listeners.delete(id as number);
    },
    legacyRegisterMenuCommand: noop,
    broadcastChannel: FakeChannel as unknown as typeof BroadcastChannel,
    emit: (key, value) => {
      for (const { key: watched, cb } of listeners.values()) {
        if (watched === key) {
          cb(key, undefined, value, true);
        }
      }
    },
  };
}

/** Greasemonkey 4: GM.* only, no value-change listener. */
export function greasemonkeySource(overrides: Partial<GmSource> = {}): GmSource {
  const store = new Map<string, unknown>();
  return {
    gm: {
      getValue: (k, f) => Promise.resolve(read(store, k, f)),
      setValue: (k, v) => {
        store.set(k, v);
        return Promise.resolve();
      },
      deleteValue: (k) => {
        store.delete(k);
        return Promise.resolve();
      },
      listValues: () => Promise.resolve([...store.keys()]),
      registerMenuCommand: noop,
    },
    ...overrides,
  };
}

/** A manager exposing only the legacy synchronous names. */
export function legacyOnlySource(): GmSource {
  const store = new Map<string, unknown>();
  return {
    legacyGetValue: (k, f) => read(store, k, f),
    legacySetValue: (k, v) => {
      store.set(k, v);
    },
    legacyDeleteValue: (k) => {
      store.delete(k);
    },
    legacyListValues: () => [...store.keys()],
    legacyAddValueChangeListener: () => 1,
    legacyRemoveValueChangeListener: noop,
  };
}

/** Delivers to every other open channel, the way a real one crosses tabs. */
export class FakeChannel {
  static open: FakeChannel[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
    FakeChannel.open.push(this);
  }

  postMessage(data: unknown): void {
    for (const other of FakeChannel.open) {
      if (other !== this) {
        other.onmessage?.({ data } as MessageEvent);
      }
    }
  }

  close(): undefined {
    FakeChannel.open = FakeChannel.open.filter((ch) => ch !== this);
  }
}

/** FakeChannel where a BroadcastChannel constructor is expected. */
export const fakeChannelCtor = FakeChannel as unknown as typeof BroadcastChannel;
