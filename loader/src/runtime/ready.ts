// Waiting for the game to reach the point where __game exists.
//
// The sequence the client goes through is body.game-active, then #ui mounts,
// then __game is assigned a fade's worth of time after first paint (src/main.ts).
// Only the first of those raises anything observable, so one poll covering all
// three is simpler than a MutationObserver that still has to poll for the last.

const READY_CLASS = 'game-active';
const HUD_ROOT = '#ui';
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
  /**
   * Resolves with the __game object.
   *
   * There is deliberately no timeout: a player can sit on the login screen for
   * as long as they like, and that is not an error to report.
   */
  ready: Promise<unknown>;
  cancel: () => void;
}

export function readGameNow(deps: ReadyDeps): unknown {
  if (!deps.doc.body?.classList.contains(READY_CLASS)) {
    return null;
  }
  if (deps.doc.querySelector(HUD_ROOT) === null) {
    return null;
  }
  return deps.readGame() ?? null;
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
