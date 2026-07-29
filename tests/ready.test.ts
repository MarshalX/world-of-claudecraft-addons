// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { type ReadyDeps, readGameNow, waitForGame } from '../loader/src/runtime/ready.ts';

const STOPPED_WAITING = /stopped waiting/;

interface Stage {
  deps: ReadyDeps;
  game: () => Record<string, unknown>;
  markActive: () => void;
  mountHud: () => void;
  assignGame: () => void;
  step: () => void;
  pending: () => number;
}

/**
 * The client reaches world entry in three steps: body.game-active, then #ui is
 * cloned in, then __game is assigned a fade later. Only the first raises
 * anything observable, which is why this is a poll.
 */
function stage(): Stage {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const assigned: Record<string, unknown> = { world: {} };
  let live: unknown = null;

  const deps: ReadyDeps = {
    doc: document,
    readGame: () => live,
    setTimer: (handler) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, handler);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    pollMs: 1,
  };

  return {
    deps,
    game: () => assigned,
    markActive: () => document.body.classList.add('game-active'),
    mountHud: () => {
      const ui = document.createElement('div');
      ui.id = 'ui';
      document.body.append(ui);
    },
    assignGame: () => {
      live = assigned;
    },
    step: () => {
      for (const handler of [...timers.values()]) {
        timers.clear();
        handler();
      }
    },
    pending: () => timers.size,
  };
}

beforeEach(() => {
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('readGameNow', () => {
  it('answers null on the home page, where none of the three exist', () => {
    expect(readGameNow(stage().deps)).toBeNull();
  });

  it('answers null while the class is set but the hud has not mounted', () => {
    const s = stage();
    s.markActive();
    s.assignGame();

    expect(readGameNow(s.deps)).toBeNull();
  });

  // The gap this covers is real: __game is assigned a whole fade after #ui
  // mounts, so the hud existing is not the same as the hook existing.
  it('answers null while the hud is up but __game has not been assigned', () => {
    const s = stage();
    s.markActive();
    s.mountHud();

    expect(readGameNow(s.deps)).toBeNull();
  });

  it('answers the hook once all three have happened', () => {
    const s = stage();
    s.markActive();
    s.mountHud();
    s.assignGame();

    expect(readGameNow(s.deps)).toBe(s.game());
  });
});

describe('waitForGame', () => {
  it('resolves as soon as the game is already there', async () => {
    const s = stage();
    s.markActive();
    s.mountHud();
    s.assignGame();

    await expect(waitForGame(s.deps).ready).resolves.toBe(s.game());
  });

  it('keeps polling through the stages and resolves at the last one', async () => {
    const s = stage();
    const wait = waitForGame(s.deps);

    s.markActive();
    s.step();
    s.mountHud();
    s.step();
    s.assignGame();
    s.step();

    await expect(wait.ready).resolves.toBe(s.game());
  });

  // A player can sit on the login screen for as long as they like, and that is
  // not an error to report.
  it('waits indefinitely rather than timing out', () => {
    const s = stage();
    waitForGame(s.deps);

    for (let i = 0; i < 500; i += 1) {
      s.step();
    }

    expect(s.pending()).toBe(1);
  });

  it('stops polling once resolved', async () => {
    const s = stage();
    s.markActive();
    s.mountHud();
    s.assignGame();

    await waitForGame(s.deps).ready;

    expect(s.pending()).toBe(0);
  });

  describe('cancel', () => {
    it('clears the pending poll', async () => {
      const s = stage();
      const wait = waitForGame(s.deps);
      expect(s.pending()).toBe(1);

      wait.cancel();

      expect(s.pending()).toBe(0);
      await expect(wait.ready).rejects.toThrow(STOPPED_WAITING);
    });

    it('is safe to call twice', async () => {
      const s = stage();
      const wait = waitForGame(s.deps);
      wait.cancel();

      expect(() => wait.cancel()).not.toThrow();
      await expect(wait.ready).rejects.toThrow();
    });
  });
});
