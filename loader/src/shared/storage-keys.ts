// The GM storage namespaces, and who owns each one.
//
// Four rather than one, and the split is about ownership rather than tidiness.
// An addon picks its own key names through `woc.storage`, so anything the loader
// also stored in that namespace would be a name the addon could take: an addon
// calling `storage.set('values', ...)` would silently become the addon whose
// settings never persist. Separating them means `storage.keys()` can also answer
// honestly, with the addon's own keys and nothing the loader put there.
//
// The two AXES are ownership and scope, and they are independent: `addon` and
// `char` are both addon-owned and differ in scope, `ui` and `char` are both
// per-character and differ in owner. Which is why per-character addon data is a
// namespace of its own rather than a prefixed key inside `addon`: sharing that
// namespace would put a key an addon writes for one character in front of
// `storage.keys()` for every other, and would let a key named after a channel
// collide with the derivation.
//
// Namespaces are prefixes on one flat GM store (see host/storage.ts), so these
// strings are the whole boundary. They cannot change without stranding data.

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
 * Where one per-character value lives, whichever namespace it lives in.
 *
 * ONE derivation for both the loader's frame state and an addon's own
 * per-character store, because "per character" has to mean the same thing in
 * both: a frame and a data key that disagreed about which character they belong
 * to would be two halves of one addon restoring for two different people.
 *
 * The channel is part of the key because character ids are issued per
 * deployment and are not comparable across them, so `char 7` on pbe and `char 7`
 * on live are different characters and must not share a window position.
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
