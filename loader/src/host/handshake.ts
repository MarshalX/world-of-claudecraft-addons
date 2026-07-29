// Sandbox half of the bootstrap: inject the runtime, then hand it a port.

import {
  bootScript,
  HANDSHAKE_TIMEOUT_MS,
  isHello,
  type MessageScope,
  portOfferMessage,
} from '../shared/handshake.ts';

interface ConnectRuntimeOpts {
  win: MessageScope;
  doc: Document;
  /** The pre-bundled runtime IIFE. */
  source: string;
  nonce: string;
  timeoutMs?: number;
}

/**
 * The script executes synchronously on insertion, so it is already done by the
 * time the element is removed and nothing observable is left in the DOM.
 *
 * At document-start `documentElement` can still be null, hence the fallbacks.
 */
function injectRuntime(doc: Document, nonce: string, source: string): void {
  const script = doc.createElement('script');
  script.textContent = bootScript({ nonce }, source);
  const mount = doc.head ?? doc.documentElement ?? doc;
  mount.appendChild(script);
  script.remove();
}

/**
 * Inject the runtime and resolve with the host end of the bridge.
 *
 * The listener goes on before the injection because the runtime posts its hello
 * from the top of the very script being injected.
 */
export function connectRuntime(opts: ConnectRuntimeOpts): Promise<MessagePort> {
  const { win, doc, source, nonce } = opts;
  const timeoutMs = opts.timeoutMs ?? HANDSHAKE_TIMEOUT_MS;

  return new Promise<MessagePort>((resolve, reject) => {
    const channel = new MessageChannel();
    let timer = 0;

    const onMessage = (event: MessageEvent<unknown>): void => {
      if (!isHello(event.data, nonce)) {
        return;
      }
      win.clearTimeout(timer);
      win.removeEventListener('message', onMessage);
      win.postMessage(portOfferMessage(nonce), win.location.origin, [channel.port2]);
      resolve(channel.port1);
    };

    timer = win.setTimeout(() => {
      win.removeEventListener('message', onMessage);
      channel.port1.close();
      channel.port2.close();
      reject(new Error(`runtime handshake timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    win.addEventListener('message', onMessage);
    injectRuntime(doc, nonce, source);
  });
}
