// The GM storage namespaces, split on two independent axes: owner (addon or loader) and scope
// (account or character). Loader data never shares a namespace with an addon's own keys, or an
// addon could overwrite it and `storage.keys()` would list it.
//
// These are prefixes on one flat GM store, so the strings are the whole boundary and cannot
// change without stranding data.

import type { Channel } from './hosts.ts';

const ADDON_NS = 'addon';
const CHARACTER_NS = 'char';
const CONFIG_NS = 'config';
const UI_NS = 'ui';

/** The addon's own key-value store, shared by every character on the account. */
function addonNamespace(fqid: string): string {
  return `${ADDON_NS}:${fqid}`;
}

/** The addon's own store for ONE character. Only addon code writes here. */
function characterNamespace(fqid: string): string {
  return `${CHARACTER_NS}:${fqid}`;
}

/** Loader-owned settings and keybind overrides, shared across hosts. Only the manager writes. */
function configNamespace(fqid: string): string {
  return `${CONFIG_NS}:${fqid}`;
}

/** Per-character UI state, which is the one thing that is NOT shared across hosts. */
function uiNamespace(fqid: string): string {
  return `${UI_NS}:${fqid}`;
}

/**
 * Where one per-character value lives. The ONE derivation for both frame state and an addon's
 * character store, so the two always agree on whose data it is. Carries the channel because
 * character ids are not comparable across deployments.
 */
function perCharacterKey(channel: Channel, characterId: string | number, name: string): string {
  return `${channel}:${characterId}:${name}`;
}

/** The single key holding an addon's hydrated settings, inside configNamespace. */
const SETTINGS_KEY = 'values';

/** The single key holding an addon's keybind overrides, inside configNamespace. */
const KEYBINDS_KEY = 'keybinds';

export {
  addonNamespace,
  characterNamespace,
  configNamespace,
  KEYBINDS_KEY,
  perCharacterKey,
  SETTINGS_KEY,
  uiNamespace,
};
