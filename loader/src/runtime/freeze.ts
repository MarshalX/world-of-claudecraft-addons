// Freezing every addon's UI, so it can be read or photographed.
//
// An addon's window is in constant motion: a meter repaints on its own interval,
// a cooldown bar redraws every animation frame, and both move again the moment
// the next frame lands on the socket. That is right in play and wrong for the two
// things a developer does with a frame, which are looking closely at it and
// taking a screenshot of it.
//
// A freeze is applied at the FOUR PLACES THE LOADER HANDS A CALLBACK TO ADDON
// CODE, never inside the addon and never inside the loader's own machinery:
// woc.timers, world.on, and the net subscriptions. Everything the loader runs for
// itself keeps running, which is deliberate: Diagnostics stays live while frozen,
// so the pane that says what the loader can see does not go stale in exactly the
// session someone is inspecting. The stylesheet handles the rest, since a CSS
// animation is not a callback and would otherwise keep moving under a freeze.
//
// The state is a module variable, ON PURPOSE, and it is never written to storage.
// Freeze is a dev switch that stops addons from doing what the player installed
// them to do, so the one thing it must never do is survive the session that set
// it: a persisted freeze is a loader that boots dead with no visible cause and a
// player has no reason to look in a Dev tab for it. A reload re-imports this
// module with the flag off, which is the whole recovery path and needs no code.
//
// A STREAM IS DROPPED AND A CHAIN IS DEFERRED, and the difference is not a
// nicety. Socket traffic and world watches are streams: dropping one frame of a
// 20 Hz topic costs one sample, while holding them would replay a backlog into
// the resume, which is a spike rather than a resume. A one-shot timer is a link
// in a chain, because an addon animates by re-arming INSIDE its own handler
// (`tick(){ draw(); woc.requestAnimationFrame(tick) }`), so a dropped handler is
// a chain that never links again: the loop is dead for the rest of the session
// and no unfreeze can revive it, since nothing is left pending to fire. Dropping
// one link costs every link after it, so one-shots are held and released here.
// That is not a symmetry argument, it is a live-session bug: cooldown-bars went
// still after an unfreeze while its events kept flowing.
//
// The held queue is bounded by construction, at most one entry per live one-shot,
// which is what makes it a different decision from the streams.

import { diagError } from '../shared/diag.ts';
import type { Teardown } from './disposal.ts';
import { FROZEN_CLASS, ROOT_ID } from './ui/root.ts';

let frozen = false;

/**
 * Who to tell when the freeze lifts.
 *
 * A signal rather than each holder polling: a held frame loop has nothing left
 * scheduled, so there is no tick of its own left for it to notice a resume on.
 * Something has to call it, and this is the only thing that knows.
 */
const resumeListeners = new Set<() => void>();

/**
 * Release every holder, whatever any one of them does.
 *
 * Guarded per listener because a drain runs ADDON code: a handler that throws on
 * the way back must not leave the addons after it in the set still frozen, which
 * would be one addon's bug becoming another addon's dead window.
 */
function release(): void {
  for (const listener of [...resumeListeners]) {
    try {
      listener();
    } catch (err) {
      diagError('a handler held by the freeze threw when it was released', err);
    }
  }
}

/**
 * Whether addon callbacks are currently held.
 *
 * Read per dispatch rather than captured at subscribe time, so a subscription
 * taken before the freeze is held by it and one taken during it runs on resume.
 */
function isFrozen(): boolean {
  return frozen;
}

/**
 * Freeze or resume, and mark the root so the stylesheet can stop animating.
 *
 * The class goes on the root rather than on each frame because the manager's own
 * chrome animates too, and a freeze that leaves the window it was toggled from
 * moving is a freeze that photographs badly. Missing root is not an error: the
 * switch is reachable from a manager the host opened before the UI mounted.
 */
function setFrozen(doc: Document, on: boolean): void {
  const was = frozen;
  frozen = on;
  doc.getElementById(ROOT_ID)?.classList.toggle(FROZEN_CLASS, on);
  // On the TRANSITION, not on every call: setting false twice must not drain a
  // queue that the second call's holders have already refilled.
  if (was && !on) {
    release();
  }
}

/**
 * Be told when the freeze lifts. Returns its own removal, for a disposal bag.
 *
 * Unregistering is how a disabled addon's held work is discarded: disable is
 * hot, so an addon torn down mid-freeze must not draw when the switch goes off.
 */
function onResume(listener: () => void): Teardown {
  resumeListeners.add(listener);
  return () => {
    resumeListeners.delete(listener);
  };
}

/**
 * The same handler, held while frozen.
 *
 * A wrapper rather than a check inside each API surface, so the four gate sites
 * read as one decision applied four times instead of four copies of an `if`.
 * The handler's own registration is untouched: a gated call is a call that did
 * not happen, so nothing unsubscribes and nothing is torn down by freezing.
 */
function unlessFrozen<A extends unknown[]>(handler: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    if (!frozen) {
      handler(...args);
    }
  };
}

/** What the Dev pane toggles. Injected, so the pane stays a pure render. */
interface FreezeControl {
  frozen: () => boolean;
  set: (on: boolean) => void;
}

/** Bind the switch to a document, for the manager to hand its Dev pane. */
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
