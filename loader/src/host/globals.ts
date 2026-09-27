// Maps the userscript manager's real globals onto GmSource. The ONLY module that names a GM
// function; gm.ts feature-detects on what this returns.
//
// Every name is guarded with typeof: a manager defines only what the metadata block granted,
// possibly as sandbox scope bindings (so no dynamic lookup), and the ambient tampermonkey types
// declare the full surface whatever a given manager actually ships.

import type { GmObject, GmSource } from './gm.ts';

/** Each member is called through GM, not detached, so a real method keeps its receiver. */
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
  // The casing differs: GM.xmlHttpRequest but GM_xmlhttpRequest. The wrong one is undefined
  // and silently leaves no marketplace reachable.
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
    // Wrapped: the manager types the id as a number, the adapter carries whatever add returned.
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
  // Guarded like the rest although no grant is needed, so a manager omitting it cannot fail boot.
  if (typeof GM_info === 'object') {
    source.scriptVersion = GM_info.script.version;
  }
  return source;
}
