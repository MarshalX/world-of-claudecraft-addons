// Freezing every addon's UI so it can be read or photographed. Applied only where the loader hands
// a callback to addon code (timers, world.on, net subscriptions); the loader's own machinery and
// Diagnostics keep running, and the stylesheet stops CSS animations.
//
// A module variable ON PURPOSE, never persisted: a freeze that survived a reload would boot a dead
// loader with no visible cause. A reload is the whole recovery path.
//
// A STREAM IS DROPPED AND A CHAIN IS DEFERRED. Holding socket traffic or world watches would replay
// a backlog into the resume. A one-shot timer is held instead, because an addon re-arms inside its
// own handler, so a dropped one-shot kills that loop for good. The held queue is bounded at one
// entry per live one-shot.

import { diagError } from '../shared/diag.ts';
import type { Teardown } from './disposal.ts';
import { FROZEN_CLASS, ROOT_ID } from './ui/root.ts';

let frozen = false;

/** A signal, not polling: a held frame loop has no tick left to notice a resume on. */
const resumeListeners = new Set<() => void>();

/** Guarded per listener: a drain runs addon code, and one throw must not leave the rest frozen. */
function release(): void {
  for (const listener of [...resumeListeners]) {
    try {
      listener();
    } catch (err) {
      diagError('a handler held by the freeze threw when it was released', err);
    }
  }
}

/** Read per dispatch, never captured at subscribe time. */
function isFrozen(): boolean {
  return frozen;
}

/**
 * The class goes on the root so the manager's own chrome stops too. A missing root is not an
 * error: the host can open the manager before the UI mounts.
 */
function setFrozen(doc: Document, on: boolean): void {
  const was = frozen;
  frozen = on;
  doc.getElementById(ROOT_ID)?.classList.toggle(FROZEN_CLASS, on);
  // On the transition only: a second false must not drain a queue its holders have refilled.
  if (was && !on) {
    release();
  }
}

/** Unregistering discards a disabled addon's held work, so it does not draw on resume. */
function onResume(listener: () => void): Teardown {
  resumeListeners.add(listener);
  return () => {
    resumeListeners.delete(listener);
  };
}

/** The same handler, dropped while frozen. Its registration is untouched. */
function unlessFrozen<A extends unknown[]>(handler: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    if (!frozen) {
      handler(...args);
    }
  };
}

/** What the Dev pane toggles, injected so the pane stays a pure render. */
interface FreezeControl {
  frozen: () => boolean;
  set: (on: boolean) => void;
}

function createFreezeControl(doc: Document): FreezeControl {
  return {
    frozen: isFrozen,
    set: (on) => {
      setFrozen(doc, on);
    },
  };
}

export type { FreezeControl };
export { createFreezeControl, isFrozen, onResume, setFrozen, unlessFrozen };
