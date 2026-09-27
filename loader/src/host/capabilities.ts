// Which halves of the GM surface a given manager actually granted, by feature detection.
//
// The adapter's paths all read this one decision, so subscribing and setValue cannot disagree
// about whether the broadcast fallback is live and deliver a change twice.

import type { GmCapabilities, GmSource } from './gm-source.ts';

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

function detectMenuCommand(src: GmSource): boolean {
  return (
    typeof src.gm?.registerMenuCommand === 'function' ||
    typeof src.legacyRegisterMenuCommand === 'function'
  );
}

/** Note the casing: the promise surface spells it xmlHttpRequest, the global does not. */
function detectHttp(src: GmSource): boolean {
  return (
    typeof src.gm?.xmlHttpRequest === 'function' || typeof src.legacyXmlHttpRequest === 'function'
  );
}

function detectCapabilities(src: GmSource): GmCapabilities {
  return {
    valueStore: detectValueStore(src),
    valueChange: detectValueChange(src),
    menuCommand: detectMenuCommand(src),
    http: detectHttp(src),
  };
}

export { detectCapabilities };
