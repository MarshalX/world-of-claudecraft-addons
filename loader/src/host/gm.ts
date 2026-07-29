// Normalizes the userscript manager's GM surface into one promise-based API.
//
// Tampermonkey and Violentmonkey expose both the legacy `GM_*` functions and the
// promise-based `GM.*` object. Greasemonkey 4 removed the legacy names and has no
// value-change listener at all, so cross-tab notification falls back to a
// BroadcastChannel that `setValue` posts to.
//
// The manager is never named in the logic: everything is feature detection, so a
// manager that gains or loses an API is handled without a version check. The
// caller maps the real globals onto GmSource, which keeps this module free of
// ambient declarations and makes every path testable.

type Listener = (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => void;

type RawGet = (key: string, fallback?: unknown) => unknown;
type RawSet = (key: string, value: unknown) => void | Promise<void>;
type RawDelete = (key: string) => void | Promise<void>;
type RawList = () => string[] | Promise<string[]>;

interface BroadcastMessage {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

interface ResolvedStore {
  get: RawGet;
  set: RawSet;
  remove: RawDelete | undefined;
  list: RawList | undefined;
}

interface BroadcastBus {
  handlers: Map<string, Set<(change: ValueChange) => void>>;
  open: () => BroadcastChannel | null;
}

function detectValueStore(src: GmSource): GmCapabilities['valueStore'] {
  if (typeof src.gm?.getValue === 'function' && typeof src.gm.setValue === 'function') {
    return 'gm4';
  }
  if (typeof src.legacyGetValue === 'function' && typeof src.legacySetValue === 'function') {
    return 'legacy';
  }
  return 'none';
}

function detectValueChange(src: GmSource): GmCapabilities['valueChange'] {
  if (
    typeof src.gm?.addValueChangeListener === 'function' ||
    typeof src.legacyAddValueChangeListener === 'function'
  ) {
    return 'native';
  }
  if (typeof src.broadcastChannel === 'function') {
    return 'broadcast';
  }
  return 'none';
}

/**
 * Bind the concrete functions once, so no call site re-decides which surface it
 * is on. `await` on a synchronous return is a no-op, which is what lets one code
 * path serve both the promise and legacy APIs.
 */
function resolveStore(src: GmSource): ResolvedStore {
  if (src.gm?.getValue !== undefined && src.gm.setValue !== undefined) {
    return {
      get: src.gm.getValue,
      set: src.gm.setValue,
      remove: src.gm.deleteValue,
      list: src.gm.listValues,
    };
  }
  if (src.legacyGetValue !== undefined && src.legacySetValue !== undefined) {
    return {
      get: src.legacyGetValue,
      set: src.legacySetValue,
      remove: src.legacyDeleteValue,
      list: src.legacyListValues,
    };
  }
  throw new Error(
    'no GM value store: the userscript manager grants neither GM.getValue nor GM_getValue',
  );
}

/**
 * The cross-tab notification path used when the manager has no listener API. The
 * channel opens lazily, so a manager with native support never creates one.
 */
function createBroadcastBus(src: GmSource, capabilities: GmCapabilities): BroadcastBus {
  const handlers = new Map<string, Set<(change: ValueChange) => void>>();
  let channel: BroadcastChannel | null = null;

  const open = (): BroadcastChannel | null => {
    if (capabilities.valueChange !== 'broadcast' || src.broadcastChannel === undefined) {
      return null;
    }
    if (channel === null) {
      channel = new src.broadcastChannel(BROADCAST_CHANNEL);
      channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
        const msg = event.data;
        if (msg === null || typeof msg !== 'object') {
          return;
        }
        for (const handler of handlers.get(msg.key) ?? []) {
          handler({ key: msg.key, oldValue: msg.oldValue, newValue: msg.newValue, remote: true });
        }
      };
    }
    return channel;
  };

  return { handlers, open };
}

function createValueApi(store: ResolvedStore, bus: BroadcastBus, capabilities: GmCapabilities) {
  const getValue = async <T>(key: string, fallback: T): Promise<T> => {
    const raw = await store.get(key, fallback);
    if (raw === undefined) {
      return fallback;
    }
    return raw as T;
  };

  const setValue = async (key: string, value: unknown): Promise<void> => {
    // Read the previous value only when something is listening through the
    // fallback, since the native listener supplies it and an extra read per
    // write is pure cost otherwise.
    const needsPrevious = capabilities.valueChange === 'broadcast' && bus.handlers.has(key);
    let oldValue: unknown;
    if (needsPrevious) {
      oldValue = await getValue<unknown>(key, undefined);
    }

    await store.set(key, value);

    if (needsPrevious) {
      bus.open()?.postMessage({ key, oldValue, newValue: value });
    }
  };

  return { getValue, setValue };
}

export interface ValueChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  /** True when the write came from another tab. */
  remote: boolean;
}

export interface GmCapabilities {
  valueStore: 'gm4' | 'legacy' | 'none';
  valueChange: 'native' | 'broadcast' | 'none';
  menuCommand: boolean;
}

export interface GmAdapter {
  getValue: <T>(key: string, fallback: T) => Promise<T>;
  setValue: (key: string, value: unknown) => Promise<void>;
  deleteValue: (key: string) => Promise<void>;
  listValues: () => Promise<string[]>;
  /** Watch one key. Returns an unsubscribe function. */
  onValueChange: (key: string, handler: (change: ValueChange) => void) => () => void;
  registerMenuCommand: (label: string, run: () => void) => void;
  readonly capabilities: GmCapabilities;
}

/**
 * The manager APIs this adapter reads, mapped by the caller from the real
 * globals. `legacy*` members correspond to the `GM_*` globals and `gm` is the
 * `GM` object. Naming them here rather than mirroring the global spellings keeps
 * this an ordinary interface with no ambient dependency.
 */
export interface GmSource {
  gm?: {
    getValue?: (key: string, fallback?: unknown) => Promise<unknown>;
    setValue?: (key: string, value: unknown) => Promise<void>;
    deleteValue?: (key: string) => Promise<void>;
    listValues?: () => Promise<string[]>;
    addValueChangeListener?: (key: string, cb: Listener) => number | string;
    removeValueChangeListener?: (id: number | string) => void;
    registerMenuCommand?: (label: string, run: () => void) => void;
  };
  legacyGetValue?: (key: string, fallback?: unknown) => unknown;
  legacySetValue?: (key: string, value: unknown) => void;
  legacyDeleteValue?: (key: string) => void;
  legacyListValues?: () => string[];
  legacyAddValueChangeListener?: (key: string, cb: Listener) => number | string;
  legacyRemoveValueChangeListener?: (id: number | string) => void;
  legacyRegisterMenuCommand?: (label: string, run: () => void) => void;
  broadcastChannel?: typeof BroadcastChannel;
}

export const BROADCAST_CHANNEL = 'woc-addons-values';

export function detectCapabilities(src: GmSource): GmCapabilities {
  return {
    valueStore: detectValueStore(src),
    valueChange: detectValueChange(src),
    menuCommand:
      typeof src.gm?.registerMenuCommand === 'function' ||
      typeof src.legacyRegisterMenuCommand === 'function',
  };
}

export function createGmAdapter(src: GmSource): GmAdapter {
  const capabilities = detectCapabilities(src);
  const store = resolveStore(src);
  const bus = createBroadcastBus(src, capabilities);
  const { getValue, setValue } = createValueApi(store, bus, capabilities);

  return {
    getValue,
    setValue,

    deleteValue: async (key: string): Promise<void> => {
      await store.remove?.(key);
    },

    listValues: async (): Promise<string[]> => (await store.list?.()) ?? [],

    onValueChange: (key, handler) => {
      const native = src.gm?.addValueChangeListener ?? src.legacyAddValueChangeListener;
      if (typeof native === 'function') {
        const remove = src.gm?.removeValueChangeListener ?? src.legacyRemoveValueChangeListener;
        const id = native(key, (changedKey, oldValue, newValue, remote) => {
          handler({ key: changedKey, oldValue, newValue, remote });
        });
        return () => remove?.(id);
      }

      const set = bus.handlers.get(key) ?? new Set();
      set.add(handler);
      bus.handlers.set(key, set);
      bus.open();

      return () => {
        set.delete(handler);
        if (set.size === 0) {
          bus.handlers.delete(key);
        }
      };
    },

    registerMenuCommand: (label, run) => {
      const register = src.gm?.registerMenuCommand ?? src.legacyRegisterMenuCommand;
      register?.(label, run);
    },

    capabilities,
  };
}
