// Page-realm entry, injected as a <script> by the host at document-start.
//
// Owns window.__game, the WebSocket hook, DOM, keybinds, and audio.

export function bootRuntime(): void {
  throw new Error('not implemented: runtime bootstrap');
}
