// Waiting for __game. The client sets body.game-active, mounts #ui, then assigns __game a fade
// later; only the first is observable, so one poll covers all three.

import { ANCHORS } from './ui/anchors.ts';

const READY_CLASS = 'game-active';
const DEFAULT_POLL_MS = 50;

export interface ReadyDeps {
  doc: Document;
  /** Reads window.__game from the page realm. */
  readGame: () => unknown;
  setTimer: (handler: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  pollMs?: number;
}

export interface GameWait {
  /** No timeout: a player can sit on the login screen indefinitely. */
  ready: Promise<unknown>;
  cancel: () => void;
}

export function readGameNow(deps: ReadyDeps): unknown {
  if (!deps.doc.body?.classList.contains(READY_CLASS)) {
    return null;
  }
  if (deps.doc.querySelector(ANCHORS.hudRoot) === null) {
    return null;
  }
  return deps.readGame() ?? null;
}

export interface DocumentReadyDeps {
  doc: Pick<Document, 'readyState' | 'addEventListener' | 'removeEventListener'>;
}

/**
 * The manager mounts here so it is reachable from the start screen. Says nothing about the HUD,
 * cloned from a template later; see ui/hud-mount.ts.
 */
export function waitForDocument(deps: DocumentReadyDeps): Promise<void> {
  if (deps.doc.readyState !== 'loading') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const onReady = (): void => {
      deps.doc.removeEventListener('DOMContentLoaded', onReady);
      resolve();
    };
    deps.doc.addEventListener('DOMContentLoaded', onReady);
  });
}

export function waitForGame(deps: ReadyDeps): GameWait {
  let timer: number | null = null;
  let stop: () => void = () => undefined;

  const ready = new Promise<unknown>((resolve, reject) => {
    const poll = (): void => {
      const game = readGameNow(deps);
      if (game !== null) {
        resolve(game);
        return;
      }
      timer = deps.setTimer(poll, deps.pollMs ?? DEFAULT_POLL_MS);
    };

    stop = () => {
      if (timer !== null) {
        deps.clearTimer(timer);
        timer = null;
      }
      reject(new Error('stopped waiting for the game'));
    };

    poll();
  });

  return { ready, cancel: () => stop() };
}
