// Sandbox bootstrap: build the host services, then hand the runtime a port.

import { expose } from 'comlink';
// biome-ignore lint/correctness/noUnresolvedImports: loader/build-runtime.mjs generates this file and Vite's ?raw suffix is a loader directive, neither of which a static resolver models
import runtimeSource from '../generated/runtime.iife.js?raw';
import { diagError } from '../shared/diag.ts';
import { createNonce, type MessageScope } from '../shared/handshake.ts';
import { isGameHost } from '../shared/hosts.ts';
import { createHostApi } from './api.ts';
import { readGmSource } from './globals.ts';
import { createGmAdapter } from './gm.ts';
import { connectRuntime } from './handshake.ts';
import { createHostStorage } from './storage.ts';

export interface HostScope extends MessageScope {
  readonly crypto: Pick<Crypto, 'getRandomValues'>;
  readonly document: Document;
}

/**
 * The @match list is broader than the origins the loader supports, since a match
 * pattern cannot express the distinction, so the origin is checked again here.
 */
export function bootHost(scope: HostScope): void {
  if (!isGameHost(scope.location.origin)) {
    return;
  }

  const gm = createGmAdapter(readGmSource());
  const api = createHostApi(createHostStorage(gm));
  const nonce = createNonce(scope.crypto);

  connectRuntime({ win: scope, doc: scope.document, source: runtimeSource, nonce })
    .then((port) => {
      expose(api, port);
    })
    .catch((err: unknown) => {
      diagError('runtime handshake failed, addons will not load', err);
    });
}
