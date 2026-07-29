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

import { diagError } from '../shared/diag.ts';
import { detectCapabilities } from './capabilities.ts';
import type {
  GmCapabilities,
  GmSource,
  ListenerHandle,
  RawDelete,
  RawGet,
  RawList,
  RawSet,
  ValueChange,
} from './gm-source.ts';
import { type HttpRequest, type HttpResponse, resolveRequester } from './http.ts';

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

const UNKNOWN_VERSION = 'unknown';

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

/**
 * Watch one key, over the manager's native listener where there is one and over
 * the broadcast fallback otherwise.
 *
 * Gated on the detected capability rather than on the function merely being
 * present, so subscribing and setValue's broadcast cannot disagree about which
 * path is live and deliver a change twice.
 */
function createValueWatcher(
  src: GmSource,
  bus: BroadcastBus,
  capabilities: GmCapabilities,
): GmAdapter['onValueChange'] {
  const native = src.gm?.addValueChangeListener ?? src.legacyAddValueChangeListener;
  const remove = src.gm?.removeValueChangeListener ?? src.legacyRemoveValueChangeListener;

  // The legacy API returns the listener id while the promise-based one resolves
  // it. The synchronous path stays synchronous: deferring it would leave a
  // window in which an unsubscribed handler still receives a change.
  const stopNative = (handle: ListenerHandle) => (): void => {
    if (typeof handle === 'number' || typeof handle === 'string') {
      remove?.(handle);
      return;
    }
    handle
      .then((id) => remove?.(id))
      .catch((err: unknown) => {
        diagError('could not remove a value-change listener', err);
      });
  };

  return (key, handler) => {
    if (capabilities.valueChange === 'native' && typeof native === 'function') {
      return stopNative(
        native(key, (changedKey, oldValue, newValue, remote) => {
          handler({ key: changedKey, oldValue, newValue, remote });
        }),
      );
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
  };
}

export interface GmAdapter {
  getValue: <T>(key: string, fallback: T) => Promise<T>;
  setValue: (key: string, value: unknown) => Promise<void>;
  deleteValue: (key: string) => Promise<void>;
  listValues: () => Promise<string[]>;
  /** Watch one key. Returns an unsubscribe function. */
  onValueChange: (key: string, handler: (change: ValueChange) => void) => () => void;
  registerMenuCommand: (label: string, run: () => void) => void;
  /**
   * A cross-origin GET, bounded by the userscript's @connect list.
   *
   * The loader's one way out of the sandbox. It exists rather than a `fetch`
   * because the page is https and the dev server is http localhost, and because
   * raw.githubusercontent.com sends no CORS headers a page could use.
   */
  request: (req: HttpRequest) => Promise<HttpResponse>;
  /** The installed userscript's version, or 'unknown' if the manager withholds it. */
  readonly scriptVersion: string;
  readonly capabilities: GmCapabilities;
}

export const BROADCAST_CHANNEL = 'woc-addons-values';

export function createGmAdapter(src: GmSource): GmAdapter {
  const capabilities = detectCapabilities(src);
  const store = resolveStore(src);
  const bus = createBroadcastBus(src, capabilities);
  const { getValue, setValue } = createValueApi(store, bus, capabilities);
  const send = src.gm?.xmlHttpRequest ?? src.legacyXmlHttpRequest;

  return {
    getValue,
    setValue,

    deleteValue: async (key: string): Promise<void> => {
      await store.remove?.(key);
    },

    listValues: async (): Promise<string[]> => (await store.list?.()) ?? [],

    onValueChange: createValueWatcher(src, bus, capabilities),

    registerMenuCommand: (label, run) => {
      const register = src.gm?.registerMenuCommand ?? src.legacyRegisterMenuCommand;
      register?.(label, run);
    },

    // A missing grant costs marketplaces, not the loader: it rejects at the call
    // rather than throwing at boot.
    request: resolveRequester(send),

    scriptVersion: src.scriptVersion ?? UNKNOWN_VERSION,
    capabilities,
  };
}

export type {
  GmCapabilities,
  GmObject,
  GmSource,
  ValueChange,
} from './gm-source.ts';
export type { HttpRequest, HttpResponse } from './http.ts';
