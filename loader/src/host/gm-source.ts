// The shape of the userscript manager, as this loader reads it. host/globals.ts maps the real
// globals onto it, which keeps the rest of the host free of ambient GM declarations.

import type { RawRequest } from './http.ts';

/** The four-argument callback both value-change APIs deliver. */
type Listener = (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => void;

type ListenerId = number | string;

/** Tampermonkey's promise-based listener API resolves the id instead of returning it. */
type ListenerHandle = ListenerId | Promise<ListenerId>;

type RawGet = (key: string, fallback?: unknown) => unknown;
type RawSet = (key: string, value: unknown) => void | Promise<void>;
type RawDelete = (key: string) => void | Promise<void>;
type RawList = () => string[] | Promise<string[]>;

interface ValueChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  /** True when the write came from another tab. */
  remote: boolean;
}

/** What the manager's surface turned out to support, detected rather than looked up by name. */
interface GmCapabilities {
  valueStore: 'gm4' | 'legacy' | 'none';
  valueChange: 'native' | 'broadcast' | 'none';
  menuCommand: boolean;
  /** Whether the manager granted a cross-origin request API at all. */
  http: boolean;
}

/** The `GM` object, reduced to the members this adapter uses. */
interface GmObject {
  getValue?: ((key: string, fallback?: unknown) => Promise<unknown>) | undefined;
  setValue?: ((key: string, value: unknown) => Promise<void>) | undefined;
  deleteValue?: ((key: string) => Promise<void>) | undefined;
  listValues?: (() => Promise<string[]>) | undefined;
  addValueChangeListener?: ((key: string, cb: Listener) => ListenerHandle) | undefined;
  removeValueChangeListener?: ((id: ListenerId) => Promise<void> | void) | undefined;
  registerMenuCommand?: ((label: string, run: () => void) => void) | undefined;
  xmlHttpRequest?: RawRequest | undefined;
}

/**
 * The manager APIs the adapter reads, mapped by the caller from the real
 * globals. `legacy*` members correspond to the `GM_*` globals and `gm` is the
 * `GM` object.
 */
interface GmSource {
  gm?: GmObject | undefined;
  legacyGetValue?: ((key: string, fallback?: unknown) => unknown) | undefined;
  legacySetValue?: ((key: string, value: unknown) => void) | undefined;
  legacyDeleteValue?: ((key: string) => void) | undefined;
  legacyListValues?: (() => string[]) | undefined;
  legacyAddValueChangeListener?: ((key: string, cb: Listener) => ListenerId) | undefined;
  legacyRemoveValueChangeListener?: ((id: ListenerId) => void) | undefined;
  legacyRegisterMenuCommand?: ((label: string, run: () => void) => void) | undefined;
  legacyXmlHttpRequest?: RawRequest | undefined;
  broadcastChannel?: typeof BroadcastChannel | undefined;
  /** The installed userscript's version, from GM_info. */
  scriptVersion?: string | undefined;
}

export type {
  GmCapabilities,
  GmObject,
  GmSource,
  Listener,
  ListenerHandle,
  ListenerId,
  RawDelete,
  RawGet,
  RawList,
  RawSet,
  ValueChange,
};
