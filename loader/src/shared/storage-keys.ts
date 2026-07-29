// The GM storage namespaces, and who owns each one.
//
// Three rather than one, and the split is about ownership rather than tidiness.
// An addon picks its own key names through `woc.storage`, so anything the loader
// also stored in that namespace would be a name the addon could take: an addon
// calling `storage.set('values', ...)` would silently become the addon whose
// settings never persist. Separating them means `storage.keys()` can also answer
// honestly, with the addon's own keys and nothing the loader put there.
//
// Namespaces are prefixes on one flat GM store (see host/storage.ts), so these
// strings are the whole boundary. They cannot change without stranding data.

import type { Channel } from './hosts.ts';

const ADDON_NS = 'addon';
const CONFIG_NS = 'config';
const UI_NS = 'ui';

/** The addon's own key-value store. Only addon code writes here. */
function addonNamespace(fqid: string): string {
  return `${ADDON_NS}:${fqid}`;
}

/**
 * Loader-owned addon configuration: settings values and keybind overrides.
 *
 * Shared across every host, so installing and configuring an addon once makes it
 * behave the same on live, pbe, and pbe2. Only the manager writes here.
 */
function configNamespace(fqid: string): string {
  return `${CONFIG_NS}:${fqid}`;
}

/** Per-character UI state, which is the one thing that is NOT shared across hosts. */
function uiNamespace(fqid: string): string {
  return `${UI_NS}:${fqid}`;
}

/**
 * Where one frame's position and visibility live.
 *
 * The channel is part of the key because character ids are issued per
 * deployment and are not comparable across them, so `char 7` on pbe and `char 7`
 * on live are different characters and must not share a window position.
 */
function frameKey(channel: Channel, characterId: string | number, frameId: string): string {
  return `${channel}:${characterId}:${frameId}`;
}

/** The single key holding an addon's hydrated settings, inside configNamespace. */
const SETTINGS_KEY = 'values';

/** The single key holding an addon's keybind overrides, inside configNamespace. */
const KEYBINDS_KEY = 'keybinds';

export { addonNamespace, configNamespace, frameKey, KEYBINDS_KEY, SETTINGS_KEY, uiNamespace };
