// Page-realm entry, injected as a <script> by the host at document-start.
//
// Owns window.__game, the WebSocket hook, DOM, keybinds, and audio.

import { diagError } from '../shared/diag.ts';
import { bootRuntime } from './boot.ts';

bootRuntime(globalThis).catch((err: unknown) => {
  diagError('runtime bootstrap failed', err);
});
