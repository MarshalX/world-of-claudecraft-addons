// Maps the userscript manager's real globals onto GmSource.
//
// Every name is guarded with typeof because a manager only defines the APIs the
// metadata block granted, and it may expose them as sandbox scope bindings
// rather than properties, which rules out a dynamic lookup. The ambient
// tampermonkey types declare the full surface, so they say nothing about what a
// given manager actually ships; the guards here are what decides. This is the
// only module that names a GM function, and gm.ts feature-detects on the shape
// it returns.

import type { GmObject, GmSource } from './gm.ts';

/**
 * Each member is called through GM rather than detached from it, so a manager
 * that implements these as real methods keeps its receiver.
 */
function readGmObject(): GmObject | undefined {
  if (typeof GM === 'undefined') {
    return;
  }
  const object: GmObject = {};
  if (typeof GM.getValue === 'function') {
    object.getValue = (key, fallback) => GM.getValue(key, fallback);
  }
  if (typeof GM.setValue === 'function') {
    object.setValue = (key, value) => GM.setValue(key, value);
  }
  if (typeof GM.deleteValue === 'function') {
    object.deleteValue = (key) => GM.deleteValue(key);
  }
  if (typeof GM.listValues === 'function') {
    object.listValues = () => GM.listValues();
  }
  if (typeof GM.addValueChangeListener === 'function') {
    object.addValueChangeListener = (key, cb) => GM.addValueChangeListener(key, cb);
  }
  if (typeof GM.removeValueChangeListener === 'function') {
    object.removeValueChangeListener = (id) => GM.removeValueChangeListener(id as number);
  }
  if (typeof GM.registerMenuCommand === 'function') {
    object.registerMenuCommand = (label, run) => GM.registerMenuCommand(label, run);
  }
  // Note the casing: the promise-based surface spells it xmlHttpRequest while
  // the legacy global is GM_xmlhttpRequest. Reaching for the wrong one finds
  // undefined and degrades silently to "no marketplace is reachable".
  if (typeof GM.xmlHttpRequest === 'function') {
    object.xmlHttpRequest = (details) =>
      GM.xmlHttpRequest(details as Parameters<typeof GM.xmlHttpRequest>[0]);
  }
  return object;
}

export function readGmSource(): GmSource {
  const source: GmSource = { gm: readGmObject() };

  if (typeof GM_getValue === 'function') {
    source.legacyGetValue = GM_getValue;
  }
  if (typeof GM_setValue === 'function') {
    source.legacySetValue = GM_setValue;
  }
  if (typeof GM_deleteValue === 'function') {
    source.legacyDeleteValue = GM_deleteValue;
  }
  if (typeof GM_listValues === 'function') {
    source.legacyListValues = GM_listValues;
  }
  if (typeof GM_addValueChangeListener === 'function') {
    source.legacyAddValueChangeListener = GM_addValueChangeListener;
  }
  if (typeof GM_removeValueChangeListener === 'function') {
    // Wrapped rather than passed through: the manager types the id as a number
    // while the adapter carries back whatever the add call returned.
    source.legacyRemoveValueChangeListener = (id) => {
      GM_removeValueChangeListener(id as number);
    };
  }
  if (typeof GM_registerMenuCommand === 'function') {
    source.legacyRegisterMenuCommand = GM_registerMenuCommand;
  }
  if (typeof GM_xmlhttpRequest === 'function') {
    source.legacyXmlHttpRequest = (details) =>
      GM_xmlhttpRequest(details as Parameters<typeof GM_xmlhttpRequest>[0]);
  }
  if (typeof BroadcastChannel === 'function') {
    source.broadcastChannel = BroadcastChannel;
  }
  // GM_info needs no grant and every manager defines it, but it is read through
  // the same guard as the rest: a manager that omits it costs one diagnostic
  // line rather than a boot failure.
  if (typeof GM_info === 'object') {
    source.scriptVersion = GM_info.script.version;
  }
  return source;
}
